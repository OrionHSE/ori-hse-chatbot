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
    'OpenAI-Beta': 'assistants=v1'
  };

  try {
    let response;
    
    switch(action) {
      case 'createThread':
        response = await fetch('https://api.openai.com/v1/threads', {
          method: 'POST',
          headers
        });
        break;
        
      case 'sendMessage':
        response = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ role: 'user', content: message })
        });
        break;
        
      case 'runAssistant':
        response = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ assistant_id: ASSISTANT_ID })
        });
        break;
        
      case 'checkStatus':
        response = await fetch(`https://api.openai.com/v1/threads/${threadId}/runs/${runId}`, {
          headers
        });
        break;
        
      case 'getMessages':
        response = await fetch(`https://api.openai.com/v1/threads/${threadId}/messages`, {
          headers
        });
        break;
        
      default:
        return res.status(400).json({ error: 'Invalid action' });
    }

    const data = await response.json();
    return res.status(response.status).json(data);
    
  } catch (error) {
    console.error('Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
