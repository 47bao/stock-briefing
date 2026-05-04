# Stock Briefing — Claude Code 루틴

이 프로젝트는 **일일 주식 브리핑**을 생성해 텔레그램으로 전송합니다.

## 루틴 명령어

Claude Code에서 아래 자연어로 실행할 수 있습니다:

| 사용자 말 | Claude Code가 실행할 명령 |
|-----------|--------------------------|
| "주식 브리핑 실행해줘" | `npx ts-node briefing.ts` |
| "브리핑 테스트해줘" | `npx ts-node briefing.ts --dry-run` |
| "내 텔레그램 chat id 알려줘" | `npx ts-node get-chat-id.ts` |
| "어제 브리핑 보여줘" | `cat ~/Documents/StockBriefings/briefing-$(date -d yesterday +%Y-%m-%d).md` |
| "오늘 브리핑 파일 열어줘" | `open ~/Documents/StockBriefings/briefing-$(date +%Y-%m-%d).md` |

## 자동 스케줄링

### macOS (launchd) — 매일 오전 8시

```bash
# 1. plist 설치
cp com.stock.briefing.plist ~/Library/LaunchAgents/

# 2. 등록
launchctl load ~/Library/LaunchAgents/com.stock.briefing.plist

# 3. 즉시 테스트
launchctl start com.stock.briefing

# 4. 로그 확인
tail -f ~/Documents/StockBriefings/launchd.log
```

### Linux (cron) — 매일 오전 8시

```
0 8 * * * cd ~/stock-briefing && npx ts-node briefing.ts >> ~/Documents/StockBriefings/cron.log 2>&1
```

## 파일 구조

```
stock-briefing/
├── CLAUDE.md           ← 이 파일 (Claude Code 루틴 정의)
├── briefing.ts         ← 메인 스크립트
├── get-chat-id.ts      ← 텔레그램 Chat ID 확인 도구
├── package.json
├── tsconfig.json
├── .env                ← API 키 (직접 생성)
└── .env.example        ← 템플릿
```

## 환경변수 (.env)

```env
ANTHROPIC_API_KEY=sk-ant-...
TELEGRAM_BOT_TOKEN=8793933214:AAHiVAQ0...
TELEGRAM_CHAT_ID=여기에_chat_id
BRIEFING_OUTPUT_DIR=/Users/유저명/Documents/StockBriefings
```

## 종목 수정

`briefing.ts` 상단의 `KOSPI_STOCKS` / `AI_SECTOR_STOCKS` 배열을 편집하세요.

## 출력 예시 (텔레그램)

메시지 1/3:
```
📊 일일 주식 브리핑
🗓 2026-05-04  🕘 오전 08:01 KST

📌 요약
코스피는 반도체 업종 강세로 0.8% 상승...

⚠️ 이슈 플래그
🚀 엔비디아 실적 예상치 상회 | ⚠️ 삼성전자 외국인 순매도
```

메시지 2/3:
```
🇰🇷 코스피 섹터
────────────────────
삼성전자(005930.KS)
가격: 72,300원 | 등락: +1.2%
뉴스: HBM3E 수주 확대 소식
...
```

메시지 3/3:
```
🤖 AI 섹터 (미국)
────────────────────
엔비디아(NVDA)
가격: $891.50 | 등락: +4.3%
뉴스: Q1 실적 예상치 20% 상회
...
```
