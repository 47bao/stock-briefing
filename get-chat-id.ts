#!/usr/bin/env npx ts-node
/**
 * get-chat-id.ts
 *
 * 텔레그램 봇의 Chat ID를 확인합니다.
 *
 * 사용법:
 *   npx ts-node get-chat-id.ts
 *
 * 실행 전: 텔레그램에서 해당 봇에게 /start 메시지를 보내야 합니다.
 */

import * as https from "https";
import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, ".env") });

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!TOKEN) {
  console.error("❌ TELEGRAM_BOT_TOKEN이 .env에 없습니다.");
  process.exit(1);
}

function getUpdates(): Promise<any> {
  return new Promise((resolve, reject) => {
    https
      .get(`https://api.telegram.org/bot${TOKEN}/getUpdates`, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(JSON.parse(data)));
      })
      .on("error", reject);
  });
}

async function main() {
  console.log("\n🔍 텔레그램 업데이트 조회 중...\n");

  const result = await getUpdates();

  if (!result.ok) {
    console.error("❌ API 오류:", result.description);
    process.exit(1);
  }

  if (result.result.length === 0) {
    console.log("📭 업데이트 없음.");
    console.log("👉 텔레그램에서 봇에게 /start 메시지를 보낸 후 다시 실행하세요.\n");
    return;
  }

  console.log("✅ 메시지 발견!\n");

  const seen = new Set<number>();
  for (const update of result.result) {
    const msg = update.message || update.channel_post;
    if (!msg) continue;

    const chatId: number = msg.chat.id;
    const chatType: string = msg.chat.type;
    const chatTitle: string = msg.chat.title || msg.chat.username || msg.chat.first_name || "";
    const text: string = msg.text || "";

    if (seen.has(chatId)) continue;
    seen.add(chatId);

    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Chat ID   : ${chatId}`);
    console.log(`유형      : ${chatType}`);
    console.log(`이름      : ${chatTitle}`);
    console.log(`마지막 메시지: ${text}`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`\n👇 .env에 아래 줄을 추가하세요:`);
    console.log(`TELEGRAM_CHAT_ID=${chatId}\n`);
  }
}

main().catch(console.error);
