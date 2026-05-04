#!/usr/bin/env npx ts-node
/**
 * stock-briefing/briefing.ts
 *
 * Claude Code 루틴으로 실행되는 일일 주식 브리핑.
 * 웹 검색 → Claude 분석 → 텔레그램 봇 전송 + 로컬 MD 백업
 *
 * Claude Code에서 실행:
 *   claude "주식 브리핑 실행해줘" --allowedTools "Bash"
 *
 * 직접 실행:
 *   npx ts-node briefing.ts
 *   npx ts-node briefing.ts --dry-run   # 텔레그램 전송 없이 콘솔만 출력
 */

import Anthropic from "@anthropic-ai/sdk";
import * as dotenv from "dotenv";
import * as fs from "fs";
import * as https from "https";
import * as path from "path";

dotenv.config({ path: path.join(__dirname, ".env") });

// ══════════════════════════════════════════════════════════════════════════════
// 설정
// ══════════════════════════════════════════════════════════════════════════════

const CONFIG = {
  telegramToken: process.env.TELEGRAM_BOT_TOKEN || "",
  telegramChatId: process.env.TELEGRAM_CHAT_ID || "",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  outputDir:
    process.env.BRIEFING_OUTPUT_DIR ||
    path.join(process.env.HOME || "~", "Documents", "StockBriefings"),
  dryRun: process.argv.includes("--dry-run"),
};

// ── 종목 리스트 ──────────────────────────────────────────────────────────────

const KOSPI_STOCKS = [
  // ▼ 핵심 3종목
  { ticker: "005930.KS", name: "삼성전자" },
  { ticker: "000660.KS", name: "SK하이닉스" },
  { ticker: "032830.KS", name: "삼성생명" },
  // ▼ 코스피 주요 추가
  { ticker: "KOSPI", name: "코스피 지수" },
  { ticker: "005380.KS", name: "현대차" },
  { ticker: "051910.KS", name: "LG화학" },
  { ticker: "035420.KS", name: "NAVER" },
  { ticker: "035720.KS", name: "카카오" },
  { ticker: "068270.KS", name: "셀트리온" },
];

const AI_SECTOR_STOCKS = [
  // ▼ 핵심 6종목
  { ticker: "GOOGL", name: "알파벳 A" },
  { ticker: "TSLA", name: "테슬라" },
  { ticker: "NVDA", name: "엔비디아" },
  { ticker: "MRVL", name: "마벨" },
  { ticker: "NFLX", name: "넷플릭스" },
  { ticker: "PLTR", name: "팔란티어" },
  // ▼ AI 섹터 추가
  { ticker: "MSFT", name: "마이크로소프트" },
  { ticker: "META", name: "메타" },
  { ticker: "AMD", name: "AMD" },
  { ticker: "AMZN", name: "아마존" },
  { ticker: "SMCI", name: "슈퍼마이크로" },
];

// ══════════════════════════════════════════════════════════════════════════════
// 유틸
// ══════════════════════════════════════════════════════════════════════════════

const kst = (): string =>
  new Date().toLocaleString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

const todayKST = (): string => {
  const d = new Date();
  const s = d.toLocaleDateString("ko-KR", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  // "2026. 05. 04." -> "2026-05-04"
  return s.replace(/\.\s*/g, "-").replace(/-$/, "");
};

const log = (msg: string) => console.log(`[${kst()}] ${msg}`);

// ══════════════════════════════════════════════════════════════════════════════
// Step 1 — 웹 검색으로 시장 데이터 수집
// ══════════════════════════════════════════════════════════════════════════════

const client = new Anthropic({ apiKey: CONFIG.anthropicApiKey });

async function fetchMarketData(
  stocks: { ticker: string; name: string }[],
  label: string
): Promise<string> {
  const list = stocks.map((s) => `${s.name}(${s.ticker})`).join(", ");
  const dateStr = todayKST();

  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 4000,
    tools: [{ type: "web_search_20250305", name: "web_search" } as any],
    messages: [
      {
        role: "user",
        content: `오늘(${dateStr}) ${label} 종목들의 최신 시장 데이터를 웹 검색으로 수집해주세요.

대상 종목: ${list}

각 종목별로 아래를 찾아주세요:
1. 현재가 또는 마지막 종가 (통화 단위 포함)
2. 전일 대비 등락률(%)
3. 오늘의 주요 뉴스 1건 (한 줄 요약)
4. 특이사항 (실적·목표가 변경·규제 등, 없으면 "-")

출력 형식:
[종목명(티커)]
가격: XXX | 등락: ±X.X%
뉴스: ...
특이: ...

정보 없으면 "확인불가"로 표시.`,
      },
    ],
  });

  return response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as any).text)
    .join("\n");
}

// ══════════════════════════════════════════════════════════════════════════════
// Step 2 — Claude로 브리핑 텍스트 생성
// ══════════════════════════════════════════════════════════════════════════════

interface Briefing {
  summary: string;
  flags: string;
  kospiMsg: string;
  aiMsg: string;
}

async function buildBriefing(
  kospiRaw: string,
  aiRaw: string
): Promise<Briefing> {
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 3000,
    messages: [
      {
        role: "user",
        content: `당신은 한국의 주식 애널리스트입니다.
아래 수집된 시장 데이터를 바탕으로 텔레그램 메시지용 일일 브리핑을 작성하세요.

=== 코스피 데이터 ===
${kospiRaw}

=== AI섹터 데이터 ===
${aiRaw}

아래 JSON 형식으로만 응답하세요 (코드블록 없이 순수 JSON):
{
  "summary": "전체 시장 1~2문장 핵심 요약",
  "flags": "주목 이슈 (예: ⚠️ 삼성전자 급락 | 🚀 엔비디아 신고가 / 없으면 '특이사항 없음')",
  "kospiMsg": "코스피 섹션 텍스트. 종목별 가격·등락·뉴스 포함. 최대 700자.",
  "aiMsg": "AI섹터 섹션 텍스트. 동일 형식. 최대 700자."
}

주의:
- 투자 권유·매수/매도 추천 절대 금지
- 숫자에 통화 단위 명시 (원, USD)
- 확인 불가 정보는 솔직하게 표시
- 각 종목은 빈 줄로 구분`,
      },
    ],
  });

  const raw = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as any).text)
    .join("");

  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("JSON 파싱 실패:\n" + raw.slice(0, 300));

  return JSON.parse(match[0]) as Briefing;
}

// ══════════════════════════════════════════════════════════════════════════════
// Step 3 — 텔레그램 전송
// ══════════════════════════════════════════════════════════════════════════════

function tgPost(text: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // 텔레그램 Markdown 특수문자 중 문제 될 수 있는 것만 이스케이프
    const safe = text
      .replace(/([_*\[\]`])/g, "\\$1");

    const body = JSON.stringify({
      chat_id: CONFIG.telegramChatId,
      text: safe,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    });

    const req = https.request(
      {
        hostname: "api.telegram.org",
        path: `/bot${CONFIG.telegramToken}/sendMessage`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          const parsed = JSON.parse(data);
          if (parsed.ok) resolve();
          else
            reject(
              new Error(`Telegram API 오류: ${JSON.stringify(parsed.description)}`)
            );
        });
      }
    );
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function sendTelegram(briefing: Briefing, dateStr: string, timeStr: string): Promise<void> {
  if (CONFIG.dryRun) {
    log("🔕 [dry-run] 텔레그램 전송 생략");
    return;
  }

  // ── 메시지 1: 헤더 + 요약 + 플래그 ──
  const msg1 = `📊 *일일 주식 브리핑*
🗓 ${dateStr}  🕘 ${timeStr} KST

📌 *요약*
${briefing.summary}

⚠️ *이슈 플래그*
${briefing.flags}`;

  // ── 메시지 2: 코스피 ──
  const msg2 = `🇰🇷 *코스피 섹터*
${"─".repeat(20)}
${briefing.kospiMsg}`;

  // ── 메시지 3: AI섹터 ──
  const msg3 = `🤖 *AI 섹터 (미국)*
${"─".repeat(20)}
${briefing.aiMsg}`;

  const messages = [msg1, msg2, msg3];
  for (let i = 0; i < messages.length; i++) {
    await tgPost(messages[i]);
    log(`📨 텔레그램 ${i + 1}/${messages.length} 전송`);
    if (i < messages.length - 1) await new Promise((r) => setTimeout(r, 600));
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Step 4 — 로컬 MD 백업
// ══════════════════════════════════════════════════════════════════════════════

function saveMarkdown(
  briefing: Briefing,
  kospiRaw: string,
  aiRaw: string,
  dateStr: string,
  timeStr: string
): string {
  if (!fs.existsSync(CONFIG.outputDir)) {
    fs.mkdirSync(CONFIG.outputDir, { recursive: true });
  }

  const content = `# 일일 주식 브리핑 — ${dateStr}

> 생성: ${timeStr} KST

## 📌 요약
${briefing.summary}

## ⚠️ 이슈 플래그
${briefing.flags}

## 🇰🇷 코스피 섹터
${briefing.kospiMsg}

## 🤖 AI 섹터 (미국)
${briefing.aiMsg}

---

<details>
<summary>📋 원본 수집 데이터</summary>

### 코스피 원본
\`\`\`
${kospiRaw}
\`\`\`

### AI섹터 원본
\`\`\`
${aiRaw}
\`\`\`
</details>
`;

  const filePath = path.join(CONFIG.outputDir, `briefing-${dateStr}.md`);
  fs.writeFileSync(filePath, content, "utf-8");
  return filePath;
}

// ══════════════════════════════════════════════════════════════════════════════
// 환경변수 검증
// ══════════════════════════════════════════════════════════════════════════════

function validateEnv(): void {
  const missing: string[] = [];
  if (!CONFIG.anthropicApiKey) missing.push("ANTHROPIC_API_KEY");
  if (!CONFIG.dryRun) {
    if (!CONFIG.telegramToken) missing.push("TELEGRAM_BOT_TOKEN");
    if (!CONFIG.telegramChatId) missing.push("TELEGRAM_CHAT_ID");
  }
  if (missing.length > 0) {
    console.error(`\n❌ 환경변수 누락:\n${missing.map((k) => `   • ${k}`).join("\n")}`);
    console.error(`\n→ .env 파일을 확인하세요: ${path.join(__dirname, ".env")}\n`);
    process.exit(1);
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// 메인
// ══════════════════════════════════════════════════════════════════════════════

async function main() {
  const dateStr = todayKST();
  const timeStr = kst();

  console.log(`\n${"═".repeat(56)}`);
  console.log(`  📈 일일 주식 브리핑${CONFIG.dryRun ? "  [DRY-RUN]" : ""}`);
  console.log(`  ${timeStr} KST`);
  console.log(`${"═".repeat(56)}\n`);

  validateEnv();

  try {
    // 1. 병렬 데이터 수집
    log("📡 코스피 + AI섹터 수집 중... (30~60초 소요)");
    const [kospiRaw, aiRaw] = await Promise.all([
      fetchMarketData(KOSPI_STOCKS, "코스피"),
      fetchMarketData(AI_SECTOR_STOCKS, "미국 AI섹터"),
    ]);
    log("✅ 데이터 수집 완료");

    // 2. 브리핑 생성
    log("✍️  브리핑 생성 중...");
    const briefing = await buildBriefing(kospiRaw, aiRaw);
    log("✅ 브리핑 생성 완료");

    // 콘솔 프리뷰
    console.log(`\n요약: ${briefing.summary}`);
    console.log(`플래그: ${briefing.flags}\n`);

    // 3. 로컬 백업
    const mdPath = saveMarkdown(briefing, kospiRaw, aiRaw, dateStr, timeStr);
    log(`💾 로컬 백업: ${mdPath}`);

    // 4. 텔레그램 전송
    log("📤 텔레그램 전송 중...");
    await sendTelegram(briefing, dateStr, timeStr);
    log("✅ 텔레그램 전송 완료");

    console.log(`\n${"═".repeat(56)}`);
    console.log("  ✅ 브리핑 완료!");
    console.log(`${"═".repeat(56)}\n`);
  } catch (err) {
    console.error("\n❌ 오류:", err);
    process.exit(1);
  }
}

main();
