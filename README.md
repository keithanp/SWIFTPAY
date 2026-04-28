# Swiftpay

Prototype fintech UI for advancing against pending App Store revenue. Stack: React 19, Vite 6, Tailwind (CDN), lucide-react, Recharts, and `@google/genai` for the dashboard advisor.

## Quick start

```bash
npm install
cp .env.example .env
# Set VITE_API_KEY in .env (Gemini API key from Google AI Studio)
npm run dev
```

- **Production build:** `npm run build`
- **Preview build:** `npm run preview`

The advisor calls **Gemini 2.5 Flash** in the browser. Treat API keys as sensitive; prefer a small backend proxy for real products.

## Repository

https://github.com/keithanp/SWIFTPAY
