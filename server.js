const express = require('express');
const path = require('path');
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.6-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`;

const BIZFORM_BASE = 'https://bizform.vitalyun.com/backend/api';
const BIZFORM_API_KEY = process.env.BIZFORM_API_KEY;
const RECORD_FORM_ID = 17;
const FIELD_IDS = {
  date: 'field_1',
  name: 'field_2',
  employeeId: 'field_3',
  category: 'field_8',
  mode: 'field_18',
  tags: 'field_21',
  analysis: 'field_22',
};

// ========== 呼叫 Gemini API ==========
// turns: [{ role: 'user'|'model', text }]
async function callGemini(turns) {
  const contents = turns.map(t => ({
    role: t.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: t.text }],
  }));

  const res = await fetch(GEMINI_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contents }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gemini API failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini 回應格式異常：' + JSON.stringify(data));
  return text;
}

// ========== 對話端點：AI 扮演家屬角色 ==========
app.post('/api/chat', async (req, res) => {
  try {
    const { history } = req.body; // [{ role: 'user'|'assistant', text }]
    if (!Array.isArray(history) || history.length === 0) {
      return res.status(400).json({ error: '請提供 history' });
    }
    const reply = await callGemini(history);
    res.json({ ok: true, reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ========== 回饋端點：AI 以督導角度給評論 ==========
app.post('/api/feedback', async (req, res) => {
  try {
    const { transcript } = req.body;
    if (!transcript) return res.status(400).json({ error: '請提供 transcript' });

    const prompt = `以下是一段禮儀專員與模擬家屬的訓練對話逐字稿：

${transcript}

請你以資深禮儀督導的角度，針對這位禮儀專員的應對表現給予簡短回饋（150字以內），包含：做得好的地方、可以改進的地方，語氣專業且具體。`;

    const feedback = await callGemini([{ role: 'user', text: prompt }]);
    res.json({ ok: true, feedback });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// ========== 寫入 BizForm 紀錄 ==========
app.post('/api/save-record', async (req, res) => {
  try {
    const { name, employeeId, category, mode, tags, analysis } = req.body;
    if (!name) return res.status(400).json({ error: '請提供 name' });

    const now = new Date();
    const dateStr = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;

    const body = {
      id: 0,
      form: { id: RECORD_FORM_ID },
      title: name,
      summary: name,
      attributes: [
        { id: FIELD_IDS.date, value: [dateStr] },
        { id: FIELD_IDS.name, value: [name] },
        { id: FIELD_IDS.employeeId, value: [employeeId || ''] },
        { id: FIELD_IDS.category, value: [category] },
        { id: FIELD_IDS.mode, value: [mode] },
        { id: FIELD_IDS.tags, value: [tags] },
        { id: FIELD_IDS.analysis, value: [analysis] },
      ],
      attachments: [],
      categories: [],
      tags: [],
      creationDateTime: now.toISOString(),
      versionCreationDateTime: now.toISOString(),
      permissions: [],
      notificationSetting: { onDocumentCreated: [], onWorkflowCompleted: [] },
      owner: null,
      versionCreator: null,
      versionNumber: 1,
      subDocuments: [],
      state: 0,
      executedDateTime: now.toISOString(),
      lastAuditor: null,
    };

    const bizRes = await fetch(`${BIZFORM_BASE}/Documents`, {
      method: 'POST',
      headers: { 'x-api-key': BIZFORM_API_KEY, 'Content-Type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
    });

    if (!bizRes.ok) {
      const text = await bizRes.text();
      throw new Error(`BizForm create failed: ${bizRes.status} ${text}`);
    }

    const created = await bizRes.json();
    const documentId = typeof created === 'number' ? created : (created && (created.id ?? created.documentId ?? null));

    res.json({ ok: true, documentId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server listening on :${PORT}`));
