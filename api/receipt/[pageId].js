const { Client } = require('@notionhq/client');

function getPageTitle(properties) {
  const titleProp = Object.values(properties).find(p => p.type === 'title');
  if (!titleProp) return '';
  return titleProp.title.map(t => t.plain_text).join('');
}

function getPropertyValue(prop) {
  if (!prop) return null;
  switch (prop.type) {
    case 'title':
      return prop.title.map(t => t.plain_text).join('');
    case 'number':
      return prop.number;
    case 'date':
      return prop.date?.start || null;
    case 'formula':
      if (prop.formula.type === 'number') return prop.formula.number;
      if (prop.formula.type === 'string') return prop.formula.string;
      if (prop.formula.type === 'date') return prop.formula.date?.start || null;
      return null;
    case 'select':
      return prop.select?.name || null;
    case 'status':
      return prop.status?.name || null;
    case 'relation':
      return prop.relation.map(r => r.id);
    case 'rollup':
      if (prop.rollup.type === 'number') return prop.rollup.number;
      if (prop.rollup.type === 'array') return prop.rollup.array.map(item => getPropertyValue(item));
      return null;
    default:
      return null;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { pageId } = req.query;
  if (!pageId) return res.status(400).json({ error: '缺少 pageId' });

  try {
    const notion = new Client({ auth: process.env.NOTION_API_KEY });
    const page = await notion.pages.retrieve({ page_id: pageId });
    const props = page.properties;

    // 標題: "260622｜王小明"
    const title = getPageTitle(props);
    const titleParts = title.split('｜');
    const receiptNumber = titleParts[0]?.trim() || '';
    const studentName = titleParts[1]?.trim() || '';

    // 直接欄位
    const paymentDate = getPropertyValue(props['繳費日期']) || '';
    const amount = getPropertyValue(props['學費']) || 0;

    // 關聯欄位 ID
    const courseIds = props['項目']?.type === 'relation' ? (getPropertyValue(props['項目']) || []) : [];
    const scheduleIds = props['排課表']?.type === 'relation' ? (getPropertyValue(props['排課表']) || []) : [];

    // 經手人員（可能是 relation、select 或 status）
    let handlerName = '';
    if (props['經手人員']?.type === 'relation') {
      const handlerIds = getPropertyValue(props['經手人員']) || [];
      if (handlerIds.length > 0) {
        const handlerPage = await notion.pages.retrieve({ page_id: handlerIds[0] });
        handlerName = getPageTitle(handlerPage.properties);
      }
    } else {
      handlerName = getPropertyValue(props['經手人員']) || '';
    }

    // 並行取得關聯頁面
    const [coursePages, schedulePages] = await Promise.all([
      Promise.all(courseIds.map(id => notion.pages.retrieve({ page_id: id }))),
      Promise.all(scheduleIds.map(id => notion.pages.retrieve({ page_id: id }))),
    ]);

    // 課程名稱
    const courseName = coursePages.length > 0 ? getPageTitle(coursePages[0].properties) : '';

    // 排課日期
    const scheduleDates = schedulePages.map(sp => {
      // 先找 Date 類型的欄位
      for (const val of Object.values(sp.properties)) {
        if (val.type === 'date' && val.date?.start) {
          return val.date.start;
        }
      }
      // 備用：從標題擷取日期
      const spTitle = getPageTitle(sp.properties);
      const match = spTitle.match(/(\d{4}\/\d{2}\/\d{2})/);
      return match ? match[1] : spTitle;
    }).sort();

    res.json({
      receiptNumber,
      studentName,
      courseName,
      amount,
      paymentDate,
      scheduleDates,
      handlerName,
      brandName: process.env.BRAND_NAME || '',
    });
  } catch (error) {
    console.error('Receipt API Error:', error);
    res.status(500).json({ error: error.message });
  }
};
