module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  res.setHeader('Access-Control-Allow-Origin', '*');

  const { action, threadId, message, runId } = req.body;
  const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
  const ASSISTANT_ID = process.env.ASSISTANT_ID;

  if (!OPENAI_API_KEY || !ASSISTANT_ID) {
    return res.status(500).json({ error: 'Missing configuration' });
  }

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${OPENAI_API_KEY}`,
    'OpenAI-Beta': 'assistants=v2'
  };

  try {
    let apiResponse;
    
    if (action === 'createThread') {
      apiResponse = await fetch('https://api.openai.com/v1/threads', {
        method: 'POST',
        headers
      });
    } else if (action === 'sendMessage') {
      apiResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ role: 'user', content: message })
      });
    } else if (action === 'runAssistant') {
      apiResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ assistant_id: ASSISTANT_ID })
      });
    } else if (action === 'checkStatus') {
      apiResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
        method: 'GET',
        headers
      });
    } else if (action === 'getMessages') {
      apiResponse = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
        method: 'GET',
        headers
      });
    } else {
      return res.status(400).json({ error: 'Invalid action' });
    }

    const data = await apiResponse.json();
    
    // Log for debugging
    console.log(`Action: ${action}, Status: ${apiResponse.status}`);
    
    if (!apiResponse.ok) {
      console.error('API Error:', data);
      return res.status(apiResponse.status).json(data);
    }

    return res.status(200).json(data);
    
  } catch (error) {
    console.error('Server Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
