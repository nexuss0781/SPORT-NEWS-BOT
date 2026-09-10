import * as readline from "readline";
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";

// One-time phone login: generates the TELEGRAM_SESSION value used by the bot.
//
//   TELEGRAM_API_ID=123456 TELEGRAM_API_HASH=abc... npm run login
//
// Or without env vars it prompts for apiId/apiHash. Requires the phone number's
// Telegram account to be reachable here (only a single client can be "logged in"
// at a time on free accounts — stop the bot before running this).

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(q: string): Promise<string> {
  return new Promise((resolve) => rl.question(q, resolve));
}

async function main(): Promise<void> {
  const apiId = Number(process.env.TELEGRAM_API_ID || (await ask("Telegram api_id: ")));
  const apiHash = process.env.TELEGRAM_API_HASH || (await ask("Telegram api_hash: "));
  if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash) {
    console.error("Invalid api_id / api_hash. Get them at https://my.telegram.org");
    process.exit(1);
  }

  // Fresh session — do not reuse the bot's TELEGRAM_SESSION here.
  const client = new TelegramClient(new StringSession(""), apiId, apiHash, {
    connectionRetries: 2,
  });

  await client.start({
    phoneNumber: async () => (await ask("Phone number (intl format, e.g. +123456): ")).trim(),
    password: async () => await ask("Two-step verification password (or empty): "),
    phoneCode: async () => (await ask("Code from Telegram: ")).trim(),
    onError: (err) => console.error("Login step failed:", err.message),
  });

  console.log("\nLogin successful. Save this exactly as TELEGRAM_SESSION:\n");
  console.log(client.session.save());
  console.log(
    "\nIn Render: Settings -> Environment -> TELEGRAM_SESSION = the string above, then redeploy."
  );

  await client.disconnect();
  rl.close();
}

main().catch((e) => {
  console.error("Login failed:", e?.errorMessage || e?.message || e);
  process.exit(1);
});