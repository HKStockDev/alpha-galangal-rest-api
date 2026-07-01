import { config } from 'dotenv';

config({ path: '.env.development' });
config({ path: '.env' });

const API_KEY = process.env.GEMINI_API_KEY;
if (!API_KEY) {
  console.error('GEMINI_API_KEY not set in .env.development or .env');
  process.exit(1);
}

const input = process.argv[2] ?? 'hello sup';

async function testGemini() {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: input }] }],
      }),
    }
  );

  const data = await res.json();
  if (!res.ok) {
    console.error('Gemini API error:', data);
    process.exit(1);
  }

  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  console.log('Input:', input);
  console.log('Output:', text ?? '(no text in response)');
}

testGemini().catch((err) => {
  console.error(err);
  process.exit(1);
});
