import { NextRequest } from 'next/server';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const runtime = 'nodejs';

const SYSTEM_PROMPT = `You are Reyna AI, the intelligent inventory assistant for Belleza Reyna — a professional Mexican cosmetics company. 

You have deep knowledge of:
- Inventory management and stock control
- Product ordering logic and supply chain
- Cosmetics industry trends
- The Belleza Reyna product catalog and suppliers

Your role is to:
1. Answer questions about current inventory, stock levels, and ordering needs
2. Analyze product performance and trends from the data provided
3. Give actionable recommendations for purchasing decisions
4. Help interpret inventory reports and identify bottlenecks
5. Provide professional business insights

Always be:
- Professional, data-driven, and concise
- Friendly but business-focused
- Proactive in offering relevant insights
- Precise with numbers and metrics

When inventory context is provided, use it to give specific, data-backed answers.
Format responses with clear structure when listing items or data.`;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { apiKey, messages, contextData } = body;

    if (!apiKey || typeof apiKey !== 'string' || !apiKey.startsWith('AI')) {
      return Response.json(
        { error: 'Invalid or missing Gemini API key. Please provide a valid key starting with "AI".' },
        { status: 400 }
      );
    }

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return Response.json({ error: 'No messages provided.' }, { status: 400 });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-3.1-flash-lite-preview' });

    // Build system + context prefix
    let systemPrefix = SYSTEM_PROMPT;
    if (contextData) {
      systemPrefix += `\n\n--- CURRENT INVENTORY CONTEXT ---\n${contextData}\n--- END CONTEXT ---`;
    }

    // Separate system message from conversation
    const conversationHistory = messages.slice(0, -1).map((m: any) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: m.parts,
    }));

    const lastMessage = messages[messages.length - 1];
    const userText = lastMessage?.parts?.[0]?.text || '';

    // Start chat with history
    const chat = model.startChat({
      history: [
        {
          role: 'user',
          parts: [{ text: systemPrefix + '\n\nI understand. I am ready to help as Reyna AI.' }],
        },
        {
          role: 'model',
          parts: [{ text: 'Understood! I\'m Reyna AI, your dedicated inventory intelligence assistant for Belleza Reyna. I\'m ready to help you analyze inventory, optimize orders, and provide actionable insights. What would you like to know?' }],
        },
        ...conversationHistory,
      ],
    });

    // Generate streaming response
    const result = await chat.sendMessageStream(userText);

    const stream = new ReadableStream({
      async start(controller) {
        const encoder = new TextEncoder();
        try {
          for await (const chunk of result.stream) {
            const text = chunk.text();
            if (text) {
              controller.enqueue(encoder.encode(text));
            }
          }
        } catch (err) {
          controller.error(err);
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Transfer-Encoding': 'chunked',
        'Cache-Control': 'no-cache',
      },
    });
  } catch (err: any) {
    console.error('Chat API error:', err);
    const message =
      err?.message?.includes('API_KEY_INVALID')
        ? 'Invalid Gemini API key. Please verify your key.'
        : err?.message || 'Internal server error';
    return Response.json({ error: message }, { status: 500 });
  }
}
