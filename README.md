# 주식 투자 × AI 활용 — 10주 강의 프레젠테이션

빔프로젝터 강의용 인터랙티브 슬라이드 도구. 단일 HTML 파일로 외부 의존성 없이 동작합니다.

## 기능
- 10주 커리큘럼 (1강 = 부의 진리·법칙 18개 카드)
- 키워드 클릭 → 설명 확장
- 주차 버튼 / 전체보기 / 모두 펼치기
- 판서 캔버스: 검정·빨강·파랑·형광펜 + 지우개 (팔레트 드래그 이동)
- 프로젝터용 큰 글씨

## 로컬 실행
`index.html`을 브라우저로 열기만 하면 됩니다.

## Cloudflare Pages 배포
1. 이 레포를 GitHub에 푸시
2. Cloudflare 대시보드 → Workers & Pages → Create → Pages → Connect to Git
3. 이 레포 선택 → Build command 비움 / Output directory `/` (루트)
4. Deploy → 자동으로 `*.pages.dev` 주소 발급

## 단축키 (판서)
`1` 검정 · `2` 빨강 · `3` 파랑 · `4` 형광 · `0`/`ESC` 선택 · `Del` 전체지우기
