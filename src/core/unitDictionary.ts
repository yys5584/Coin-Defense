// ═══ 유닛 사전 (상세 툴팁용) ═══
export interface UnitDictEntry {
    role: string;
    flavorText: string;
    skillDesc: { star1: string; star2: string; star3: string };
}

export const UNIT_DICTIONARY: Record<string, UnitDictEntry> = {
    // ══════════════════════════════════════
    // ⚪ 1코스트
    // ══════════════════════════════════════
    pcminer: {
        role: '🔋 마나 주유소',
        flavorText: '사장님 몰래 구석 자리에서 GTX 1060으로 이더리움을 캐던 전설의 시작. 지금은 전기세가 더 나옵니다.',
        skillDesc: {
            star1: '인접 아군 1명 마나 15 회복',
            star2: '인접 아군 2명 마나 30 회복',
            star3: '★★★ 주변 8칸 모든 아군 마나 50 회복 + 공속 20%↑',
        },
    },
    scamdev: {
        role: '🦠 전염병 (디버퍼)',
        flavorText: '백서는 화려하지만 Github 커밋 기록은 단 1줄, "Hello World"뿐입니다.',
        skillDesc: {
            star1: '단일 적 3초 도트. 킬 시 1명 전이',
            star2: '4초 도트. 킬 시 2명 전이',
            star3: '★★★ 5초 도트. 킬 시 주변 전체 무한 전이',
        },
    },
    hodler: {
        role: '🛡️ 무한 성장 탱커',
        flavorText: '"비트코인을 사면 팔지 마라." HODLer의 신조는 단순합니다. 다이아몬드 핸드.',
        skillDesc: {
            star1: '확정 크리 1타 (누적 크리DMG +10%)',
            star2: '확정 크리 3타',
            star3: '★★★ 매 시전 영구 크리DMG 누적. 갈수록 한방이 강해짐',
        },
    },
    memecoin: {
        role: '⚡ 체인 라이트닝 딜러',
        flavorText: '도지코인, 시바이누, 페페… 밈에서 태어나 밈으로 죽는 코인의 왕.',
        skillDesc: {
            star1: '체인 3회 + 킬 시 마나 페이백',
            star2: '체인 4회 + 킬 마나 강화',
            star3: '★★★ 체인 5회 + 킬 시 마나 100% → 무한 연쇄',
        },
    },
    fudspreader: {
        role: '💀 DoT 딜러 + 마나 구슬',
        flavorText: '"비트코인은 죽었다"를 1만 번 외친 자. 공포를 먹고 사는 존재.',
        skillDesc: {
            star1: '단일 적 도트 부여',
            star2: '3명에게 도트',
            star3: '★★★ 사망 시 마나 구슬 드롭 → 아군 마나 충전',
        },
    },
    piuser: {
        role: '🔨 연타 암살자',
        flavorText: '폰으로 채굴한다는 달콤한 거짓말에 수백만이 넘어갔습니다.',
        skillDesc: {
            star1: '2연타 강타',
            star2: '3연타 강타',
            star3: '★★★ 3연타 + 15% 확률 즉사 (보스 제외)',
        },
    },
    tradebot: {
        role: '⚙️ 공속 무한 누적',
        flavorText: '0.001초 만에 주문을 넣고 빼는 초단타 봇. 감정 따위는 없습니다.',
        skillDesc: {
            star1: '자신 공속 버프',
            star2: '더 강한 공속 버프',
            star3: '★★★ 매 시전 영구 공속 누적. 시간이 갈수록 미쳐감',
        },
    },
    kol: {
        role: '📢 팀 마나 충전기',
        flavorText: '"1000배 간다!" 그의 한 마디에 커뮤니티가 불탑니다.',
        skillDesc: {
            star1: '주변 아군 마나 소량 충전',
            star2: '넓은 범위 마나 충전',
            star3: '★★★ 모든 Social 아군 마나 100% 즉시 충전',
        },
    },
    gareth: {
        role: '🐌 광역 감속기',
        flavorText: '차트만 보면 모든 게 하락장입니다. 영원한 비관론자.',
        skillDesc: {
            star1: '다수 적 감속',
            star2: '더 많은 적 감속 + 지속시간↑',
            star3: '★★★ 감속 + 트루뎀 디버프',
        },
    },
    roubini: {
        role: '🐻 HP비례 DoT',
        flavorText: '"암호화폐는 사기다!" 2008년 금융위기를 예언한 둠세이어.',
        skillDesc: {
            star1: 'HP비례 도트 (단일)',
            star2: 'HP비례 도트 (3체)',
            star3: '★★★ HP비례 도트 + 최대HP 영구 삭제',
        },
    },
    metamask: {
        role: '🦊 아군 공속 버퍼',
        flavorText: '가스비 폭발! 이더리움 거래의 관문. 매번 수수료에 놀랍니다.',
        skillDesc: {
            star1: '자신+인접 아군 공속↑',
            star2: '더 넓은 범위 공속↑',
            star3: '★★★ 강력한 광역 공속 버프',
        },
    },
    perpdex: {
        role: '🏦 관통 빔 + 마나 수확',
        flavorText: '100배 레버리지의 세계. 한 방에 부자, 한 방에 거지.',
        skillDesc: {
            star1: '관통 빔 (명중당 마나 회복)',
            star2: '더 많은 관통 + 마나',
            star3: '★★★ 대량 관통 + 마나 수확 극대화',
        },
    },
    a16zintern: {
        role: '👔 방어 분쇄기',
        flavorText: 'Silicon Valley의 인턴이지만 리서치 능력은 시니어급.',
        skillDesc: {
            star1: '다수 적 물방 깎기',
            star2: '더 많은 적 방깎',
            star3: '★★★ 광역 방깎 + 스턴',
        },
    },
    cramer: {
        role: '📺 빙결 + 역주행',
        flavorText: '"이 종목은 매수!" 라고 하면 100% 폭락. 인버스 크레이머의 법칙.',
        skillDesc: {
            star1: '다수 적 빙결',
            star2: '더 많은 적 빙결',
            star3: '★★★ 빙결 + 적 경로 역주행',
        },
    },
    curve: {
        role: '🔄 슬로우 + 마나 리젠',
        flavorText: '스테이블코인 스왑의 왕. 곡선이 아름답습니다.',
        skillDesc: {
            star1: '광역 슬로우',
            star2: '강화된 슬로우',
            star3: '★★★ 광역 슬로우 + 아군 마나 리젠',
        },
    },

    // ══════════════════════════════════════
    // 🟡 2코스트
    // ══════════════════════════════════════
    jessepowell: {
        role: '💰 골드 파밍 & 막타',
        flavorText: '거래소는 항상 승리합니다. 출금 수수료는 별도.',
        skillDesc: {
            star1: '200 버스트 딜. 킬 시 +1G',
            star2: '450 딜. 킬 시 1G + 마나 30 페이백',
            star3: '★★★ 1200 딜. 킬 시 2G + 마나 100% → 연속 시전',
        },
    },
    wonyotti: {
        role: '🥷 최강 아군 공속 버퍼',
        flavorText: '풀시드 롱으로 전설이 된 트레이더. 확신의 올인.',
        skillDesc: {
            star1: '가장 강한 아군 공속↑',
            star2: '더 강한 버프',
            star3: '★★★ 최강 아군 공속 대폭↑',
        },
    },
    hsaka: {
        role: '❄️ 빙결 + 보너스 딜',
        flavorText: '크립토 윈터의 화신. HP 50% 이하 적에게 2배 딜.',
        skillDesc: {
            star1: '다수 적 빙결 + 빙결 적 보너스 딜',
            star2: '더 많은 빙결 + 긴 지속',
            star3: '★★★ 대량 빙결 + 빙결 적 추가딜 극대화',
        },
    },
    jackdorsey: {
        role: '⚡ 체인 + 감전 장판',
        flavorText: '트위터를 만들고 비트코인에 올인한 남자.',
        skillDesc: {
            star1: '체인 라이트닝',
            star2: '더 많은 체인',
            star3: '★★★ 체인 + 감전 DoT + 아군 마나 회복',
        },
    },
    jessepollak: {
        role: '🌐 체인 + DeFi 버프',
        flavorText: 'Base 체인의 아버지. 온체인 경제를 꿈꾸는 빌더.',
        skillDesc: {
            star1: '체인 딜 + DeFi 아군 공속↑',
            star2: '더 많은 체인 + 강한 버프',
            star3: '★★★ 대량 체인 + DeFi 팀 전체 공속 폭↑',
        },
    },
    halfinney: {
        role: '🔑 ₿ 사거리 버퍼',
        flavorText: '최초의 비트코인 수신자. 사토시가 보낸 첫 거래의 주인공.',
        skillDesc: {
            star1: '₿ 아군 공속↑',
            star2: '더 강한 ₿ 팀 버프',
            star3: '★★★ 모든 ₿ 유닛 공속 대폭↑',
        },
    },
    kashkari: {
        role: '🏛️ 광역 슬로우 + 빙결',
        flavorText: '금리 인상의 화신. "인플레이션은 일시적"이라는 거짓말.',
        skillDesc: {
            star1: '광역 슬로우',
            star2: '전체 슬로우',
            star3: '★★★ 전체 빙결 + 골드 보너스',
        },
    },
    kris: {
        role: '💳 골드 비례 딜러',
        flavorText: 'Crypto.com의 CEO. "Fortune favors the brave."',
        skillDesc: {
            star1: '버스트 딜 + 킬골드',
            star2: '강화된 버스트',
            star3: '★★★ 보유 골드 비례 추가 딜 폭발',
        },
    },
    cdixon: {
        role: '📖 아군 크리 버퍼',
        flavorText: '"Read Write Own" — Web3의 철학을 설파하는 VC의 거물.',
        skillDesc: {
            star1: '범위 내 아군 크리/공속↑',
            star2: '더 넓은 버프 범위',
            star3: '★★★ 대범위 크리 버프 극대화',
        },
    },
    opensea: {
        role: '🔍 아군 딜 버퍼',
        flavorText: 'NFT 마켓플레이스의 왕좌. 민팅 수수료가 곧 힘.',
        skillDesc: {
            star1: '최강 아군 1명 딜↑',
            star2: '2명 딜↑',
            star3: '★★★ 다수 아군 딜 대폭↑',
        },
    },
    craigwright: {
        role: '💀 디버프 + 스킬 표절',
        flavorText: '"나는 사토시다!" 자칭 비트코인 창시자. 소송이 취미.',
        skillDesc: {
            star1: 'DoT + 방깎',
            star2: '3체 DoT + 방깎',
            star3: '★★★ DoT+방깎 + 최강 아군 스킬 50% 복사딜',
        },
    },
    daniele: {
        role: '👻 관통 + HP 되감기',
        flavorText: 'Wonderland의 몰락. 리베이스 토큰의 꿈과 악몽.',
        skillDesc: {
            star1: '관통 빔',
            star2: '더 많은 관통',
            star3: '★★★ 관통 + maxHP 20% 트루뎀 폭발',
        },
    },
    ruja: {
        role: '👸 골드 생성기',
        flavorText: '원코인 사기로 40억 달러를 들고 사라진 크립토 퀸. FBI 수배 1순위.',
        skillDesc: {
            star1: '킬 시 골드 획득',
            star2: '더 많은 골드',
            star3: '★★★ 대량 골드 + 주변 아군 버프',
        },
    },

    // ══════════════════════════════════════
    // 🟢 3코스트
    // ══════════════════════════════════════
    rekt: {
        role: '🪓 연쇄 처형인',
        flavorText: '100배 레버리지 롱을 쳤다가 전 재산이 증발. 이제 남의 숨통을 끊는 데 집착합니다.',
        skillDesc: {
            star1: 'HP 20% 이하 즉사. 마나 50% 환급',
            star2: 'HP 23% 이하 즉사. 마나 ~100% 환급',
            star3: '★★★ HP 26% 이하 전체 스캔 연쇄 처형! 킬 시 마나 100% → 무한 난사',
        },
    },
    wintermute: {
        role: '🤖 광역 폭발 + HP컷',
        flavorText: '알고리즘 마켓 메이커. 유동성의 지배자.',
        skillDesc: {
            star1: '스플래시 50% (3체)',
            star2: '더 넓은 스플래시',
            star3: '★★★ 스플래시 + 전체 적 HP 50% 삭제',
        },
    },
    akang: {
        role: '🦈 빙결 + 마나통 축소',
        flavorText: '풀 레버리지 숏으로 유명한 트레이더. 공매도의 달인.',
        skillDesc: {
            star1: '3체 빙결',
            star2: '4체 빙결',
            star3: '★★★ 5체 빙결 + 영구 maxMana 축소 → 스킬 가속',
        },
    },
    andre: {
        role: '🧙 DeFi 마법사',
        flavorText: 'Yearn Finance 창시자. "I test in prod." 프로덕션에서 테스트하는 광인.',
        skillDesc: {
            star1: '체인 라이트닝',
            star2: '더 많은 체인',
            star3: '★★★ 대량 체인 + DeFi 시너지 극대화',
        },
    },
    simon: {
        role: '🎯 확정크리 + 아군 영구DMG↑',
        flavorText: '시드 투자의 귀재. 남들이 못 보는 가치를 찾아냅니다.',
        skillDesc: {
            star1: '고배율 확정 크리',
            star2: '더 높은 크리 배율',
            star3: '★★★ 초고배율 크리 + 모든 아군 영구 공격력↑',
        },
    },
    peterschiff: {
        role: '🧊 기절 + 황금동상',
        flavorText: '비트코인 부정론자이자 금 매니아. "비트코인은 디지털 거품!"',
        skillDesc: {
            star1: '다수 기절',
            star2: '더 많은 기절',
            star3: '★★★ 5초 황금동상 기절 + 방깎',
        },
    },
    rogerver: {
        role: '⛏️ 관통 + 넉백',
        flavorText: '"비트코인 캐시가 진짜 비트코인이다!" 영원한 분쟁의 중심.',
        skillDesc: {
            star1: '관통 빔',
            star2: '더 많은 관통',
            star3: '★★★ 전체 적 넉백 + 기절',
        },
    },
    cathie: {
        role: '🏹 저격 + 분석',
        flavorText: 'ARK Invest의 CEO. "혁신은 과소평가된다."',
        skillDesc: {
            star1: '고딜 저격',
            star2: '강화 저격',
            star3: '★★★ 초강력 저격 + 방무시',
        },
    },
    warren: {
        role: '⚖️ 규제 디버프',
        flavorText: '"암호화폐 산업을 규제해야 합니다!" 크립토의 영원한 적.',
        skillDesc: {
            star1: '적 디버프',
            star2: '광역 디버프',
            star3: '★★★ 전체 적 약화',
        },
    },
    cobie: {
        role: '🎩 정보 전쟁',
        flavorText: 'CT(크립토 트위터)의 인플루언서. 내부 정보의 달인.',
        skillDesc: {
            star1: '단일 강타',
            star2: '강화된 강타',
            star3: '★★★ 초강력 강타 + 보너스 효과',
        },
    },
    gcr: {
        role: '🐸 예언자',
        flavorText: '크립토 최고의 트레이더. 시장의 흐름을 읽는 초능력자.',
        skillDesc: {
            star1: '강력한 일격',
            star2: '더 강한 일격',
            star3: '★★★ 초월적 딜 + 특수 효과',
        },
    },
    heart: {
        role: '💎 하이리스크 딜러',
        flavorText: 'HEX 창시자. "최고의 투자 기회!" 논란의 아이콘.',
        skillDesc: {
            star1: '버스트 딜',
            star2: '강화된 버스트',
            star3: '★★★ 초고딜 버스트',
        },
    },
    chefnomi: {
        role: '🍣 DeFi 먹튀',
        flavorText: 'SushiSwap 개발자금을 들고 튄 전설의 셰프. 나중에 돌려줬습니다.',
        skillDesc: {
            star1: '딜 + 골드',
            star2: '강화된 딜',
            star3: '★★★ 고딜 + 골드 보너스',
        },
    },
    burry: {
        role: '🔍 빅쇼트',
        flavorText: '2008년 서브프라임 위기를 예측한 전설의 투자자.',
        skillDesc: {
            star1: '강력한 저격',
            star2: '더 강한 저격',
            star3: '★★★ 초강력 저격 + 방무시',
        },
    },

    // ══════════════════════════════════════
    // 🔷 4코스트
    // ══════════════════════════════════════
    zhusu: {
        role: '🕳️ 몹몰이 블랙홀',
        flavorText: '"비트코인 10만 불!" 100억$ 펀드를 공중분해시킨 남자.',
        skillDesc: {
            star1: '반경 2칸 몹몰이 + 폭발',
            star2: '2초 흡입 + 대폭발',
            star3: '★★★ 전체 흡입 + 3000 트루딜 + 3초 영구기절',
        },
    },
    balaji: {
        role: '🎯 보스 저격수',
        flavorText: '"비트코인 90일 안에 100만 달러 간다!" 백만불 베팅의 남자.',
        skillDesc: {
            star1: '최고HP 적 3연사',
            star2: '딜 2배 + 방무시 50%',
            star3: '★★★ 딜 4배 + 방무시 100% → 보스 킬러',
        },
    },
    anatoly: {
        role: '⚡ 기절 + 시간 정지',
        flavorText: 'Solana 창시자. 네트워크 지연은 특기가 아니라 설계입니다(?)',
        skillDesc: {
            star1: '다수 기절',
            star2: '더 많은 기절 + 지속↑',
            star3: '★★★ 전체 적 4초 빙결 (시간 정지)',
        },
    },
    lazarus: {
        role: '💀 기절 + 넥서스 힐',
        flavorText: '북한 해킹 그룹. 수십억 달러의 암호화폐를 탈취한 유령.',
        skillDesc: {
            star1: '광역 기절 + DoT',
            star2: '더 넓은 기절',
            star3: '★★★ 기절+DoT + 기지HP 회복',
        },
    },
    marc: {
        role: '💰 체인 + 포탑 소환',
        flavorText: 'a16z 수장. "소프트웨어가 세상을 집어삼킨다."',
        skillDesc: {
            star1: '체인 라이트닝',
            star2: '체인 + 방깎',
            star3: '★★★ 체인 + 자동 포탑 소환 + 마나 충전',
        },
    },
    hayden: {
        role: '🦄 체인 + HP 스왑',
        flavorText: 'Uniswap 창시자. AMM의 혁명을 일으킨 유니콘.',
        skillDesc: {
            star1: '체인 딜',
            star2: '더 많은 체인',
            star3: '★★★ 체인 + 최고HP↔최저HP 적 HP% 스왑',
        },
    },
    gavin: {
        role: '🔗 마방 분쇄기',
        flavorText: 'Polkadot 창시자. 이더리움 공동 창립자.',
        skillDesc: {
            star1: '단일 적 마방 깎기',
            star2: '더 많은 마방깎',
            star3: '★★★ 대량 마방 분쇄',
        },
    },
    stani: {
        role: '🔒 방어 흡수 + 원기옥',
        flavorText: 'AAVE 창시자. 탈중앙 대출의 새 시대를 열었습니다.',
        skillDesc: {
            star1: '적 방어력 흡수',
            star2: '더 많은 흡수',
            star3: '★★★ 방어 흡수 + 전아군 DMG 합산 원기옥!',
        },
    },

    // ══════════════════════════════════════
    // 💎 5코스트
    // ══════════════════════════════════════
    saylor: {
        role: '♾️ 무한 성장 다마고치',
        flavorText: '회사 빚을 내서라도 비트코인을 무한 추매(HODL). 수량만이 전부.',
        skillDesc: {
            star1: '킬 시 영구 스킬DMG +15 누적',
            star2: '킬 시 영구 +40 누적',
            star3: '★★★ 킬 시 +100 누적 + 평타에 누적딜 스플래시',
        },
    },
    dokwon: {
        role: '💣 시한폭탄 & 데미지 저축',
        flavorText: '연 이율 20%를 보장한다며 전 세계를 홀린 남자. 루나 사태의 주범.',
        skillDesc: {
            star1: '3초 뒤 폭발. 아군 딜 30% 누적 합산',
            star2: '60% 누적 합산 폭발',
            star3: '★★★ 150% 누적 + 4자탄 연쇄 대폭발',
        },
    },
    sbf: {
        role: '🚩 방깎 + 스턴',
        flavorText: 'FTX 붕괴의 주범. 고객 자금으로 도박한 천재 사기꾼.',
        skillDesc: {
            star1: '방어력 깎기 + 스턴',
            star2: '더 강한 방깎',
            star3: '★★★ 대량 방깎 + 장기 스턴',
        },
    },
    justinsun: {
        role: '🌪️ HP% 딜러',
        flavorText: 'TRON 창시자. 과대광고의 달인. "Just wait!"',
        skillDesc: {
            star1: '적 HP% 비례 피해 (3체)',
            star2: '더 많은 HP% 피해',
            star3: '★★★ 전체 적 HP% 삭제',
        },
    },
    hayes: {
        role: '🎰 갬블러 딜러',
        flavorText: 'BitMEX 창시자. "100배 레버리지가 진짜 크립토다."',
        skillDesc: {
            star1: '확률적 고딜',
            star2: '더 높은 확률 + 딜',
            star3: '★★★ 초고확률 극딜',
        },
    },
    etf: {
        role: '📈 무한 관통 빔',
        flavorText: '기관 자금의 물결. 월스트리트가 크립토에 올인한 순간.',
        skillDesc: {
            star1: '관통 빔',
            star2: '딜 2배 관통',
            star3: '★★★ 무한 관통 + 빔 강도 누적 + 마나 자급',
        },
    },
    armstrong: {
        role: '🏛️ 거래소 보스',
        flavorText: 'Coinbase CEO. 규제와 싸우는 합법 크립토의 수호자.',
        skillDesc: {
            star1: '강력한 버스트',
            star2: '더 강한 버스트',
            star3: '★★★ 초강력 버스트 + 팀 버프',
        },
    },
    jeff: {
        role: '🏎️ 스피드 딜러',
        flavorText: '속도가 곧 정의. 누구보다 빠르게.',
        skillDesc: {
            star1: '빠른 연타',
            star2: '더 빠른 연타',
            star3: '★★★ 초고속 연타 + 특수 효과',
        },
    },
    aave: {
        role: '🏦 방어 흡수 + 원기옥',
        flavorText: '플래시 론의 원조. 0초 만에 빌리고 갚는 DeFi의 핵심.',
        skillDesc: {
            star1: '방어력 흡수',
            star2: '방어+마방 흡수',
            star3: '★★★ 전아군 DMG 합산 ×10 → 원기옥 폭발!',
        },
    },
    coplan: {
        role: '🔮 예측 시장',
        flavorText: 'Polymarket 창시자. 미래를 거래하는 예언 시장의 신.',
        skillDesc: {
            star1: '예측 딜',
            star2: '강화된 예측',
            star3: '★★★ 초강력 예측 + 보너스',
        },
    },

    // ══════════════════════════════════════
    // 👑 7코 & 10코 (궁극 유닛)
    // ══════════════════════════════════════
    cz: {
        role: '🐋 블랙홀 지배자',
        flavorText: '"Funds are SAFU." 바이낸스의 황제. 시장을 한 손에 쥔 고래.',
        skillDesc: {
            star1: '전체 블랙홀 흡입 + 스턴 + 1.5x 딜',
            star2: '더 강한 흡입',
            star3: '★★★ 초강력 블랙홀 + 영구 기절',
        },
    },
    vitalik: {
        role: '🌟 더 머지 (전아군 마나 100%)',
        flavorText: '이더리움 창시자. 세상을 바꾼 천재 프로그래머.',
        skillDesc: {
            star1: '스플래시 폭발 + 전아군 마나 100% 충전!',
            star2: '더 강한 폭발',
            star3: '★★★ 초강력 폭발 + 모든 아군 궁극기 즉시 발동',
        },
    },
    elon: {
        role: '🚀 화성 로켓 (전체 넉백)',
        flavorText: '"우리는 화성에 간다." 한 마디에 시장이 흔들리는 남자.',
        skillDesc: {
            star1: '전체 넉백 + 스턴 + 아군 광분',
            star2: '더 강한 넉백',
            star3: '★★★ 초강력 넉백 + 전아군 초광분',
        },
    },
    gensler: {
        role: '👨‍⚖️ 규제의 칼날',
        flavorText: 'SEC 위원장. "크립토는 모두 증권이다!" 업계의 공포.',
        skillDesc: {
            star1: '적 약화 + 골드 압수',
            star2: '더 강한 규제',
            star3: '★★★ 전체 적 초강력 규제',
        },
    },
    trump: {
        role: '⛏️ 채굴 대통령',
        flavorText: '"미국을 비트코인 수도로 만들겠다!" 대선 공약의 반전.',
        skillDesc: {
            star1: '강력한 일격',
            star2: '더 강한 일격',
            star3: '★★★ 초강력 일격 + 특수 효과',
        },
    },

    // ══════════════════════════════════════
    // 🌟 10코 (신화)
    // ══════════════════════════════════════
    satoshi: {
        role: '⏳ 시간 지배자 (The Creator)',
        flavorText: '모든 것의 기원이자 끝. 그가 누구인지 아무도 모릅니다. 코드가 그를 증명할 뿐.',
        skillDesc: {
            star1: '전체 HP 50% 삭제 + 잡몹 즉사 + 5초 시간 정지',
            star2: '-',
            star3: '-',
        },
    },
};
