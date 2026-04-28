import { GoogleGenAI } from '@google/genai';
import type { FinancialState } from '../types';

export async function getFinancialInsights(financials: FinancialState): Promise<string> {
  const key = process.env.API_KEY;
  if (!key) {
    return 'Add your Gemini API key as VITE_API_KEY in a .env file to enable personalized AI advice.';
  }

  const ai = new GoogleGenAI({ apiKey: key });

  const prompt = `You are a sharp fintech advisor for mobile app developers using Swiftpay (advances against pending App Store revenue).

Developer snapshot:
- Pending Apple payout (locked): $${financials.pendingAppleRevenue.toLocaleString()}
- Cash in bank (liquid): $${financials.cashInBank.toLocaleString()}
- Available advance limit: $${financials.availableAdvance.toLocaleString()}
- Total already advanced: $${financials.totalAdvanced.toLocaleString()}

Give ONE punchy recommendation in 1-2 sentences: should they take an advance now to fund growth/ads, or wait? Be direct and confident. No bullet points.`;

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
  });

  const text = response.text?.trim();
  if (!text) {
    return 'Could not load advice right now. Try again in a moment.';
  }
  return text;
}
