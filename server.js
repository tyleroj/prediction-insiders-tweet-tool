const express = require('express');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const storage = multer.memoryStorage();
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

app.use(express.static('public'));
app.use(express.json());

const SYSTEM_PROMPT = `You are a tweet writer for Prediction Insiders, a tool on OddsJam (oddsjam.com/prediction/insiders) that tracks sharp insider bets on Polymarket.

The user will provide one or two screenshots:
- A screenshot of a bet card from the Prediction Insiders tool
- Optionally, a screenshot of their Polymarket betting slip

Your job is to write a 2-tweet thread that announces the play and breaks down why the tool flagged it.

RULES:
- No em dashes (never use —)
- No filler or hype words like "amazing" or "incredible"
- Use specific numbers from the screenshots — do not generalize or make up numbers
- Keep tweet 1 under 220 characters
- Tweet 2 should focus on exactly 3 data points: slippage/entry price, relative bet size, and insider ROI
- End tweet 2 with the score and "Higher score = better opportunity to follow."
- Do not fabricate numbers. Only use what is visible in the screenshots.
- Tone: confident, direct, data-driven. Not salesy.
- No em dashes anywhere.

TWEET 1 FORMAT:
[Sport] [Label] [emoji]

[Team A] vs [Team B] [Bet Type] @ [current price or odds]

Play came right from the NEW Prediction Insiders Tool

Full breakdown below 👇

TWEET 2 FORMAT:
Took this play straight from the @OddsJam Prediction Insiders Tool:
oddsjam.com/prediction/insiders

[1 sentence on what the tool does — no em dashes]

The insider entered at [X]% — current price is [Y]%. That's [Z] slippage, which the tool factors into the score.

This bet is [Xb]x this insider's typical bet size. That level of conviction matters.

Their historical ROI: [ROI]% across [Trades] trades.

Score: [Score]/100. Higher score = better opportunity to follow.

SPORT LABEL GUIDE (pick the most fitting based on sport and score):
- Score 95-100: "Nuke", "Max", "Lock"
- NBA: "NBA Sharp", "NBA Nuke"
- NFL: "NFL Whale", "NFL Signal"
- NHL: "NHL Nuke", "NHL Sharp"
- Soccer: "Soccer Sharp", "UCL Insider"
- Generic: "Polymarket Sharp", "Insider Alert"

If the user provides a custom label, use that instead.

OUTPUT FORMAT:
Return ONLY the two tweets separated by this exact separator on its own line:
---TWEET-BREAK---

No preamble, no explanation, just the two tweets with the separator between them.`;

app.post('/generate', upload.fields([
  { name: 'toolCard', maxCount: 1 },
  { name: 'slip', maxCount: 1 }
]), async (req, res) => {
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server.' });
    }

    const client = new Anthropic({ apiKey });

    const toolCardFile = req.files['toolCard']?.[0];
    const slipFile = req.files['slip']?.[0];
    const customLabel = req.body.label || '';

    if (!toolCardFile) {
      return res.status(400).json({ error: 'Tool card screenshot is required.' });
    }

    const imageContent = [];

    imageContent.push({
      type: 'text',
      text: 'Here is the Prediction Insiders tool card screenshot:'
    });
    imageContent.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: toolCardFile.mimetype,
        data: toolCardFile.buffer.toString('base64')
      }
    });

    if (slipFile) {
      imageContent.push({
        type: 'text',
        text: 'Here is the Polymarket betting slip screenshot:'
      });
      imageContent.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: slipFile.mimetype,
          data: slipFile.buffer.toString('base64')
        }
      });
    }

    const labelText = customLabel
      ? `\n\nCustom label to use in Tweet 1: "${customLabel}"`
      : '';

    imageContent.push({
      type: 'text',
      text: `Please generate the 2-tweet thread based on these screenshots.${labelText}`
    });

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: imageContent }]
    });

    const fullText = message.content[0].text;
    const parts = fullText.split('---TWEET-BREAK---');

    res.json({
      tweet1: parts[0]?.trim() || '',
      tweet2: parts[1]?.trim() || ''
    });

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Something went wrong.' });
  }
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
