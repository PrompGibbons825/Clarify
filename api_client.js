const fetch = require('node-fetch');
const FormData = require('form-data');

class APIClient {
  constructor(baseUrl) {
    this.baseUrl = baseUrl.replace(/\/$/, ''); // ensure no trailing slash
    this.token = null;
  }

  async getUser() {
    const response = await fetch(`${this.baseUrl}/api/auth/me`, {
      headers: this.getHeaders()
    });
    await this._checkResponse(response);
    return response.json();
  }

  async getApiKey() {
    // Return OpenAI key from env or user settings
    const key = process.env.OPENAI_API_KEY;
    if (!key) {
      console.warn('Warning: OPENAI_API_KEY not set in environment variables');
    }
    return key;
  }

  async createSession(data) {
    const response = await fetch(`${this.baseUrl}/api/sessions`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(data)
    });
    await this._checkResponse(response);
    return response.json();
  }

  async transcribeAudio(sessionId, audioData) {
    const formData = new FormData();

    // Ensure audioData is a Buffer or typed array
    const buffer = Buffer.isBuffer(audioData)
      ? audioData
      : Buffer.from(audioData);

    formData.append('audio', buffer, { filename: 'audio.wav' });
    formData.append('session_id', sessionId);

    const response = await fetch(`${this.baseUrl}/api/audio/transcribe`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.token || ''}`, // don't add JSON header here
        ...formData.getHeaders()
      },
      body: formData
    });

    await this._checkResponse(response);
    return response.json();
  }

  getHeaders() {
    const headers = {
      'Content-Type': 'application/json'
    };
    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }
    return headers;
  }

  async _checkResponse(response) {
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`HTTP ${response.status}: ${text}`);
    }
  }
}

module.exports = APIClient;
