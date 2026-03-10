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

HOW TO READ THE TOOL CARD SCREENSHOT:
The tool card contains these specific fields. Read them carefully and do not confuse them:
- The large number top-left (e.g. 94) = the score out of 100
- The money bag icon + dollar amount (e.g. $37.3k) = the SIZE of the insider's bet in dollars. This is NOT "tracked volume". Use it to describe how much the insider placed on this position.
- The price tag icon + cents value (e.g. 57.1c) = the INSIDER'S ENTRY PRICE. This is what the insider paid, not the current price.
- The up arrow icon + multiplier (e.g. 3.7x) = RELATIVE BET SIZE. How many times larger this bet is compared to the insider's typical bet.
- The magnifying glass icon + percentage (e.g. 9.5%) = the insider's SPORTS ROI (their historical return on investment on sports bets).
- "Current" + cents value (e.g. 58c) = the CURRENT MARKET PRICE right now.
- Slippage = the difference between current price and the insider's entry price. Calculate it as: current price minus insider entry price.

RULES:
- NEVER use em dashes (the — character). This is a hard rule with zero exceptions. Replace any em dash with a comma, colon, or rewrite the sentence.
- No filler or hype words like "amazing" or "incredible"
- Use specific numbers from the screenshots only. Do not fabricate or estimate numbers.
- Keep tweet 1 under 220 characters
- Tweet 2 must cover exactly 3 data points in this order: (1) insider entry price vs current price and slippage, (2) relative bet size as a conviction signal, (3) insider's sports ROI percentage
- End tweet 2 with the score and "Higher score = better opportunity to follow."
- Tone: confident, direct, data-driven. Not salesy.

TWEET 1 FORMAT:
[Sport] [Label] [emoji]

[Team A] vs [Team B] [Bet Type] @ [current price in cents]

Play came right from the NEW Prediction Insiders Tool

Full breakdown below 👇

TWEET 2 FORMAT:
Took this play straight from the @OddsJam Prediction Insiders Tool:
oddsjam.com/prediction/insiders

[1 sentence: the tool identifies specific sharp insiders on Polymarket and tells you exactly when and how much to follow their bets]

The insider entered at [insider entry price]c. Current price is [current price]c. That's [slippage amount] of slippage factored into the score.

This bet is [Xb]x this insider's typical bet size. They put $[bet size] on this position. That kind of size means high conviction.

Their sports ROI: [ROI]%.

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
