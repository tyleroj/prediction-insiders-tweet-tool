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

HARD RULES (never break these):
- NEVER use em dashes (the character). Zero exceptions. Rewrite with a comma, colon, or new sentence.
- Never fabricate numbers. Use only what is visible in the screenshots.
- Keep tweet 1 under 220 characters.
- Tweet 2 must include all 3 data points: insider entry vs current price + slippage, relative bet size, and sports ROI.
- End tweet 2 with the score and a line about what the score means.
- Never use the words "amazing", "incredible", "game-changer", or other pure hype filler.

VARIETY RULES (critical - read carefully):
Multiple different affiliates will post these threads from their own accounts. Each generation must feel distinct from the last. You must actively rotate and vary:
- The hook structure and opening line of tweet 1 (never repeat the same pattern)
- The framing of each data point in tweet 2 (same facts, different angle each time)
- The one-sentence description of what Prediction Insiders does (must be different every generation)
- The CTA and closing line
- Sentence rhythm, structure, and length throughout

TWEET 1 HOOK OPTIONS - rotate between these styles. Pick a different one each generation:
Style A - Lead with the event: "[Sport] [Label] [emoji]\n\n[Team A] vs [Team B], [Bet Type] @ [price]c\n\nFlagged by the Prediction Insiders tool. Thread below"
Style B - Lead with the score: "[Score]/100 on the Prediction Insiders tool.\n\n[Team A] vs [Team B] [Bet Type]\n\nThat score doesn't show up often. Here's why"
Style C - Lead with bet size: "An insider just put $[bet size] on [Team A] [Bet Type] on Polymarket.\n\nScore: [Score]/100.\n\nPrediction Insiders flagged it. Full breakdown"
Style D - Lead with slippage: "Still [slippage]c of slippage on this one. Insider got in at [entry]c, it's [current]c now.\n\n[Team A] vs [Team B] [Bet Type]\n\nBreakdown"
Style E - Lead with ROI: "This insider has a [ROI]% sports ROI. They just went [X]x their normal size on [Team A] [Bet Type].\n\nPrediction Insiders flagged it."
Style F - Lead with tension or question: "How does a sharp drop $[bet size] on Polymarket and score a [Score]/100?\n\n[Team A] vs [Team B] [Bet Type]\n\nHere's what the tool found"

Always end tweet 1 with a line pointing to the thread below. Keep tweet 1 under 220 characters.

TWEET 2 STYLE TONES:
The user may specify one of these. If not specified, pick the best fit and vary it across generations:
- Sharp & Direct: Minimal words. Dense data. No filler commentary.
- Hype: More energy and urgency. Strong verbs. Still data-driven but punchy.
- Analytical: Explain the "why" behind each data point with brief context.
- Casual: Conversational, first-person feel. Like texting a friend the play.

TWEET 2 REQUIREMENTS:
- Open with a one-sentence description of what Prediction Insiders does. This sentence MUST be different every generation. Vary the angle: sometimes focus on the insider identification, sometimes on the scoring system, sometimes on the follow-sizing, sometimes on the edge it gives bettors.
- Include @OddsJam and oddsjam.com/prediction/insiders somewhere in tweet 2.
- Cover these 3 data points (order can vary, framing must vary each time):
  1. Insider entry price vs current price, and what the slippage means for the score
  2. Relative bet size (the X multiplier) as a conviction signal, and the dollar amount placed
  3. The insider's sports ROI as a credibility anchor
- Close with the score out of 100 and what a high score means for the opportunity.

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
    const style = req.body.style || '';

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

    const labelText = customLabel ? `\n\nCustom label to use in Tweet 1: "${customLabel}"` : '';
    const styleText = style ? `\n\nTweet 2 tone/style to use: ${style}` : '';

    imageContent.push({
      type: 'text',
      text: `Please generate the 2-tweet thread based on these screenshots.${labelText}${styleText}\n\nIMPORTANT: Vary your hook style and sentence structure. Do not default to the same pattern as a previous generation.`
    });

    const message = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      temperature: 1,
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
