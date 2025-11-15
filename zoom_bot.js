const puppeteer = require('puppeteer-core');
const EventEmitter = require('events');
const fetch = require('node-fetch'); // If Node 18+, you can use global fetch and remove this dependency
const crypto = require('crypto');

class ZoomBot extends EventEmitter {
  constructor(openaiKey, options = {}) {
    super();
    this.openaiKey = openaiKey;
    this.browser = null;
    this.page = null;
    this.sessionId = null;
    this.monitorInterval = null;
    this.seenMessages = new Set();
    // Optionally allow overriding launch options (e.g. executablePath)
    this.launchOptions = Object.assign({
      headless: false,
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--disable-web-security'
      ],
      // IMPORTANT: puppeteer-core requires an executablePath. Pass it via options.executablePath
      // e.g. new ZoomBot(KEY, { executablePath: '/path/to/chrome' })
      executablePath: options.executablePath || undefined
    }, options.launchOptions || {});
  }

  async join(zoomLink, sessionId) {
    this.sessionId = sessionId;

    if (!zoomLink) throw new Error('zoomLink is required');

    try {
      // Launch Chromium/Chrome - puppeteer-core requires executablePath (or use puppeteer instead)
      this.browser = await puppeteer.launch(this.launchOptions);

      this.page = await this.browser.newPage();
      await this.page.setViewport({ width: 1280, height: 720 });

      // Improve navigation stability
      await this.page.goto(zoomLink, { waitUntil: 'networkidle2', timeout: 30000 });

      // Try to wait for either a name input or some join button — selector may vary by Zoom client/web
      // Adjust selectors to your Zoom web layout if needed
      const nameSelector = 'input[name="name"], input#inputname, input[aria-label="Your name"]';
      await this.page.waitForSelector(nameSelector, { timeout: 15000 });

      // Enter name (clear first if needed)
      await this.page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) {
          el.focus();
          el.value = '';
        }
      }, nameSelector);

      // Use page.type to type the bot name
      await this.page.type(nameSelector, 'Clarify AI Bot');

      // Click join button — selector may vary; try a few fallbacks
      const joinSelectors = [
        'button[type="submit"]',
        'button[aria-label*="Join"]',
        'button[data-role="join-button"]',
        '.join-button'
      ];
      let clicked = false;
      for (const sel of joinSelectors) {
        try {
          const el = await this.page.$(sel);
          if (el) {
            await el.click();
            clicked = true;
            break;
          }
        } catch (e) {
          // ignore and try next selector
        }
      }

      // If no join button clicked, try pressing Enter from the name field
      if (!clicked) {
        await this.page.keyboard.press('Enter');
      }

      // Wait a little for meeting to fully load (tune as needed)
      await this.page.waitForTimeout(5000);

      // Start monitoring chat
      this.startChatMonitoring();

      console.log('Successfully joined Zoom meeting');
      return true;
    } catch (err) {
      console.error('Failed to join meeting:', err);
      // Clean up partially created browser if exists
      try { if (this.page) await this.page.close(); } catch (_) {}
      try { if (this.browser) await this.browser.close(); } catch (_) {}
      this.page = null;
      this.browser = null;
      throw err;
    }
  }

  startChatMonitoring(pollMs = 2000) {
    if (!this.page) {
      throw new Error('Page not initialized. Call join() first.');
    }

    // Clear any existing interval
    if (this.monitorInterval) clearInterval(this.monitorInterval);

    this.monitorInterval = setInterval(async () => {
      try {
        // Extract chat messages from page - selector names are placeholders and must match your Zoom UI
        const messages = await this.page.evaluate(() => {
          // adjust selectors to match the Zoom web app used
          const chatElements = document.querySelectorAll('.chat-item, .chat-list-item, .chat-message');
          return Array.from(chatElements).map(el => {
            // Try multiple possible child selectors
            const sender = el.querySelector('.sender-name, .name, .chat-item-sender')?.textContent?.trim() || 'Unknown';
            const message = el.querySelector('.chat-message-text, .message, .chat-text')?.textContent?.trim() || '';
            // Use DOM time if available
            const timeAttr = el.querySelector('.time, .timestamp')?.getAttribute('data-timestamp') || el.querySelector('.time, .timestamp')?.textContent;
            const timestamp = timeAttr ? String(timeAttr) : new Date().toISOString();
            return { sender, message, timestamp };
          });
        });

        if (!Array.isArray(messages) || messages.length === 0) return;

        for (const msg of messages) {
          const id = this._hashMessage(msg);
          if (!this.seenMessages.has(id)) {
            this.seenMessages.add(id);
            // Keep the seenMessages set bounded to avoid memory growth
            if (this.seenMessages.size > 1000) {
              // drop oldest half (simple approach)
              const keep = new Set([...this.seenMessages].slice(-500));
              this.seenMessages = keep;
            }

            this.emit('chat-message', msg);
            // Process questions asynchronously but don't block the loop
            this.processMessage(msg).catch(err => {
              console.error('processMessage error:', err);
            });
          }
        }
      } catch (error) {
        console.error('Chat monitoring error:', error);
      }
    }, pollMs);
  }

  _hashMessage(msg) {
    // Create a stable ID for dedup using sender+message+timestamp
    const key = `${msg.sender}||${msg.message}||${msg.timestamp}`;
    return crypto.createHash('sha1').update(key).digest('hex');
  }

  isNewMessage(msg) {
    // Deprecated — dedup handled by seenMessages set
    return !this.seenMessages.has(this._hashMessage(msg));
  }

  async processMessage(msg) {
    // Basic filter: only questions (tweak as needed)
    if (!msg.message || !msg.message.includes('?')) return;

    try {
      const payload = {
        model: 'gpt-4',
        messages: [
          {
            role: 'system',
            content: 'You are an AI co-moderator. Analyze if this is a question and provide a helpful answer.'
          },
          {
            role: 'user',
            content: msg.message
          }
        ],
        temperature: 0.2,
        max_tokens: 500
      };

      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.openaiKey}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        // optional: timeout handling can be added via AbortController
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        throw new Error(`OpenAI API error (${response.status}): ${errText}`);
      }

      const data = await response.json();
      const answer = data?.choices?.[0]?.message?.content?.trim();

      if (!answer) {
        throw new Error('No answer returned from OpenAI');
      }

      await this.postToChat(answer);

      this.emit('ai-response', {
        question: msg.message,
        answer,
        confidence: 85,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Processing error:', error);
      // Optionally emit an error event
      this.emit('processing-error', { error: error.message, msg });
    }
  }

  async postToChat(message) {
    if (!this.page) throw new Error('Page not initialized');

    try {
      // Wait for the chat input element — selectors will vary depending on Zoom UI
      const inputSelectors = ['.chat-input', 'textarea.chat-input', 'input.chat-input', 'textarea[aria-label="Send a message"]'];
      let found = false;

      for (const sel of inputSelectors) {
        const exists = await this.page.$(sel);
        if (exists) {
          // Use evaluate to set value and dispatch input events to ensure apps pick it up
          await this.page.evaluate((selector, msg) => {
            const el = document.querySelector(selector);
            if (!el) return false;
            // For input/textarea
            el.focus();
            el.value = msg;
            // dispatch 'input' event so React/Angular apps notice the change
            el.dispatchEvent(new Event('input', { bubbles: true }));
            // dispatch change if needed
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return true;
          }, sel, message);

          // Press Enter (works for textarea/input)
          await this.page.keyboard.press('Enter');

          found = true;
          break;
        }
      }

      if (!found) {
        // fallback: try executing any known post button
        const posted = await this.page.evaluate((msg) => {
          // As a last resort, find a button with "Send" text
          const btn = Array.from(document.querySelectorAll('button')).find(b => /send/i.test(b.textContent));
          if (btn) {
            // try to fill nearby input
            const input = document.querySelector('textarea, input[type="text"]');
            if (input) {
              input.value = msg;
              input.dispatchEvent(new Event('input', { bubbles: true }));
            }
            btn.click();
            return true;
          }
          return false;
        }, message);

        if (!posted) {
          throw new Error('Could not find chat input or send button to post message');
        }
      }

      console.log('Posted to chat:', message);
    } catch (error) {
      console.error('Failed to post to chat:', error);
      this.emit('post-error', { error: error.message, message });
    }
  }

  async leave() {
    // Clear monitoring interval
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }

    // Close page and browser safely
    try {
      if (this.page && !this.page.isClosed()) {
        await this.page.close();
      }
    } catch (err) {
      console.warn('Error closing page:', err);
    } finally {
      this.page = null;
    }

    try {
      if (this.browser) {
        await this.browser.close();
      }
    } catch (err) {
      console.warn('Error closing browser:', err);
    } finally {
      this.browser = null;
    }

    console.log('Left Zoom meeting');
  }
}

module.exports = ZoomBot;