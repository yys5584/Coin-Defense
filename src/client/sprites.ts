// ============================================================
// Sprite System — Unit-ID + Origin-based sprite mapping
// 우선순위: /assets/units/{unitId}.png > /sprites/{origin}.png > emoji
// ============================================================

import { Origin } from '../core/types';

// ─── Origin별 스프라이트 경로 (Legacy fallback) ───────────────
const ORIGIN_SPRITES: Record<string, string> = {
    [Origin.Bitcoin]: '/sprites/bitcoin.png',
    [Origin.DeFi]: '/sprites/defi.png',
    [Origin.Social]: '/sprites/social.png',
    [Origin.Exchange]: '/sprites/exchange.png',
    [Origin.VC]: '/sprites/vc.png',
    [Origin.FUD]: '/sprites/fud.png',
    [Origin.Rugpull]: '/sprites/rugpull.png',
    [Origin.Bear]: '/sprites/bear.png',
};

// ─── 스프라이트 시트 매핑 (해시 결정론적 매핑) ──────────────
// 코스트별 색상: 1-2=blue, 3=green, 4=red, 5+=yellow
const COST_COLOR: Record<number, string> = {
    1: 'blue', 2: 'blue', 3: 'green', 4: 'red', 5: 'yellow', 7: 'yellow', 10: 'yellow',
};

// 실제 파일 시스템과 정확히 일치하는 [폴더명, 파일접두사] 매핑
// [폴더명, 파일접두사, cols, rows, posX오프셋(옵션)]
// 현재 모든 유닛 = falconwarrior (10×8: 가로10프레임, 세로8행)
const SPRITE_CHARS: Array<[string, string, number, number, number?]> = [
    ['falconwarrior', 'falconwarrior', 10, 8],
    ['falconwarrior', 'falconwarrior', 10, 8],
    ['falconwarrior', 'falconwarrior', 10, 8],
    ['falconwarrior', 'falconwarrior', 10, 8],
    ['falconwarrior', 'falconwarrior', 10, 8],
    ['falconwarrior', 'falconwarrior', 10, 8],
    ['falconwarrior', 'falconwarrior', 10, 8],
    ['falconwarrior', 'falconwarrior', 10, 8],
    ['falconwarrior', 'falconwarrior', 10, 8],
    ['falconwarrior', 'falconwarrior', 10, 8],
    ['falconwarrior', 'falconwarrior', 10, 8],
    ['falconwarrior', 'falconwarrior', 10, 8],
    ['falconwarrior', 'falconwarrior', 10, 8],
    ['falconwarrior', 'falconwarrior', 10, 8],
    ['falconwarrior', 'falconwarrior', 10, 8],
    ['falconwarrior', 'falconwarrior', 10, 8],
    ['falconwarrior', 'falconwarrior', 10, 8],
    ['falconwarrior', 'falconwarrior', 10, 8],
];

/** 결정론적 해시: 같은 unitId → 항상 같은 인덱스 */
function hashUnitId(unitId: string): number {
    let h = 0;
    for (let i = 0; i < unitId.length; i++) {
        h = ((h << 5) - h + unitId.charCodeAt(i)) | 0;
    }
    return Math.abs(h);
}

/** 유닛 ID → 스프라이트 시트 경로 + 프레임 정보 (결정론적 해시 배정) */
export function getUnitSpriteSheet(unitId: string, origin: string, cost: number): {
    path: string; color: string; char: string; cols: number; rows: number;
} {
    const charIdx = hashUnitId(unitId) % SPRITE_CHARS.length;
    const [folder, filePrefix, cols, rows] = SPRITE_CHARS[charIdx];
    const color = COST_COLOR[cost] ?? 'blue';
    return {
        path: `/assets/units/animal/animal/${folder}/${filePrefix}_${color}.png`,
        color, char: filePrefix, cols, rows,
    };
}

/** 유닛 스프라이트 시트 정보 반환 (경로 + background-size/position CSS) */
export function getUnitSpriteInfo(unitId: string, origin: string, cost: number): {
    url: string; bgSize: string; bgPos: string;
} {
    const ss = getUnitSpriteSheet(unitId, origin, cost);
    const charIdx = hashUnitId(unitId) % SPRITE_CHARS.length;
    const posX = SPRITE_CHARS[charIdx][4] ?? 0;
    return {
        url: ss.path,
        bgSize: `${ss.cols * 100}% ${ss.rows * 100}%`,
        bgPos: posX !== 0 ? `${posX}% 0` : '0 0',
    };
}

// 하위 호환 — 제거 예정
export function getUnitSpriteUrl(unitId: string, origin: string, cost: number): string {
    return getUnitSpriteSheet(unitId, origin, cost).path;
}
export function getSpriteFirstFrameStyle(_u: string, _o: string, _c: number, _s: number = 48): string { return ''; }
export function preloadAllUnitFrames(_u: any[]): void { }
export function setFrameReadyCallback(_cb: () => void): void { }

// ─── 몬스터 스프라이트 ───────────────────────────────────────
export const MONSTER_SPRITE = '/sprites/monster.png';
export const BOSS_SPRITE = '/sprites/boss.png';

// ─── 코스트별 테두리 글로우 색상 (디렉터 확정) ────────────────
export const COST_GLOW: Record<number, string> = {
    1: '#9ca3af',  // 회색
    2: '#10b981',  // 초록
    3: '#3b82f6',  // 파랑
    4: '#8b5cf6',  // 보라
    5: '#f59e0b',  // 금색
    7: '#ef4444',  // 빨강
    10: '#ef4444', // 무지개(CSS에서 gradient 처리)
};

export const COST_GLOW_SHADOW: Record<number, string> = {
    1: '0 0 4px rgba(156,163,175,.4), inset 0 0 2px rgba(156,163,175,.2)',
    2: '0 0 6px rgba(16,185,129,.5), inset 0 0 3px rgba(16,185,129,.2)',
    3: '0 0 8px rgba(59,130,246,.5), inset 0 0 4px rgba(59,130,246,.2)',
    4: '0 0 10px rgba(139,92,246,.6), inset 0 0 4px rgba(139,92,246,.3)',
    5: '0 0 12px rgba(245,158,11,.6), inset 0 0 5px rgba(245,158,11,.3)',
    7: '0 0 16px rgba(239,68,68,.7), 0 0 30px rgba(239,68,68,.3), inset 0 0 6px rgba(239,68,68,.3)',
    10: '0 0 12px rgba(239,68,68,.6), 0 0 20px rgba(168,85,247,.4), 0 0 30px rgba(59,130,246,.3), 0 0 40px rgba(245,158,11,.3)',
};

// ─── 스프라이트 로드 캐시 ────────────────────────────────────
const spriteCache = new Map<string, HTMLImageElement | null>();
const loadingSet = new Set<string>();

/**
 * 이미지를 미리 로드하고 캐시합니다.
 * 존재하지 않는 이미지는 null로 캐시됩니다.
 */
function preloadSprite(src: string): Promise<HTMLImageElement | null> {
    if (spriteCache.has(src)) return Promise.resolve(spriteCache.get(src)!);
    if (loadingSet.has(src)) return Promise.resolve(null);

    loadingSet.add(src);
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            spriteCache.set(src, img);
            loadingSet.delete(src);
            resolve(img);
        };
        img.onerror = () => {
            spriteCache.set(src, null); // 이미지 없음 → 이모지 폴백
            loadingSet.delete(src);
            resolve(null);
        };
        img.src = src;
    });
}

/**
 * Origin에 해당하는 스프라이트를 반환합니다.
 * 아직 로드 중이거나 없으면 null을 반환합니다.
 */
export function getOriginSprite(origin: string): HTMLImageElement | null {
    const src = ORIGIN_SPRITES[origin];
    if (!src) return null;

    if (spriteCache.has(src)) return spriteCache.get(src) ?? null;

    // 비동기 프리로드 시작 (다음 렌더에 사용 가능)
    preloadSprite(src);
    return null;
}

/**
 * 유닛 ID에 해당하는 스프라이트를 반환합니다.
 * 우선순위: /assets/units/{unitId}.png → /sprites/{origin}.png → null
 */
export function getUnitSprite(unitId: string, origin: string): HTMLImageElement | null {
    // 1) 유닛 ID 전용 이미지 체크
    const unitSrc = `/assets/units/${unitId}.png`;
    if (spriteCache.has(unitSrc)) {
        const cached = spriteCache.get(unitSrc);
        if (cached) return cached;
    } else {
        preloadSprite(unitSrc);
    }

    // 2) Origin 스프라이트 폴백
    return getOriginSprite(origin);
}

/**
 * 캐시된 스프라이트가 있는지 확인합니다.
 */
export function hasSpriteFor(origin: string): boolean {
    const src = ORIGIN_SPRITES[origin];
    if (!src) return false;
    const cached = spriteCache.get(src);
    return cached !== undefined && cached !== null;
}

/**
 * 유닛 ID 기반 스프라이트가 있는지 확인합니다.
 */
export function hasUnitSprite(unitId: string): boolean {
    const src = `/assets/units/${unitId}.png`;
    const cached = spriteCache.get(src);
    return cached !== undefined && cached !== null;
}

/**
 * 모든 Origin 스프라이트를 미리 로드합니다.
 */
export async function preloadAllSprites(): Promise<void> {
    const promises = Object.values(ORIGIN_SPRITES).map(src => preloadSprite(src));
    promises.push(preloadSprite(MONSTER_SPRITE));
    promises.push(preloadSprite(BOSS_SPRITE));
    await Promise.all(promises);
}

/**
 * 몬스터 스프라이트를 반환합니다.
 */
export function getMonsterSprite(isBoss: boolean): HTMLImageElement | null {
    const src = isBoss ? BOSS_SPRITE : MONSTER_SPRITE;
    if (spriteCache.has(src)) return spriteCache.get(src) ?? null;
    preloadSprite(src);
    return null;
}

/**
 * 유닛 카드용 HTML 요소를 생성합니다.
 * 우선순위: /assets/units/{unitId}.png → /sprites/{origin}.png → emoji 폴백
 */
export function createUnitVisual(origin: string, emoji: string, size: number = 32, unitId?: string): HTMLElement {
    // 유닛 ID 우선 → Origin 폴백
    const sprite = unitId ? getUnitSprite(unitId, origin) : getOriginSprite(origin);

    if (sprite) {
        const img = document.createElement('img');
        img.src = sprite.src;
        img.alt = unitId || origin;
        img.width = size;
        img.height = size;
        img.style.cssText = 'image-rendering: pixelated; object-fit: contain; pointer-events: none;';
        img.draggable = false;
        return img;
    }

    // 폴백: CSS background-image (이미지 로드 후 자동 반영, 없으면 투명)
    const wrapper = document.createElement('div');
    wrapper.className = 'unit-img-fallback';
    wrapper.style.cssText = `
        width: ${size}px; height: ${size}px;
        background-image: url('/assets/units/${unitId || 'unknown'}.png');
        background-size: 80%; background-repeat: no-repeat; background-position: center bottom;
        background-color: transparent;
        image-rendering: pixelated;
        display: flex; align-items: center; justify-content: center;
        font-size: ${size * 0.7}px; line-height: 1;
    `;
    return wrapper;
}

/**
 * Canvas 위에 유닛 스프라이트를 그립니다 (전투 렌더링용).
 */
export function drawUnitSprite(
    ctx: CanvasRenderingContext2D,
    origin: string,
    emoji: string,
    x: number, y: number,
    size: number,
    cost: number = 1,
    unitId?: string,
): void {
    const sprite = unitId ? getUnitSprite(unitId, origin) : getOriginSprite(origin);

    // 코스트별 글로우 효과
    const glowColor = COST_GLOW[cost] || COST_GLOW[1];
    ctx.save();

    if (sprite) {
        // 글로우 아래 그리기
        ctx.shadowColor = glowColor;
        ctx.shadowBlur = cost >= 5 ? 8 : cost >= 3 ? 5 : 3;
        ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
        ctx.shadowBlur = 0;
    } else {
        // 이모지 폴백
        ctx.font = `${size * 0.7}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(emoji, x, y);
    }

    ctx.restore();
}

/**
 * Canvas 위에 몬스터 스프라이트를 그립니다.
 */
export function drawMonsterSprite(
    ctx: CanvasRenderingContext2D,
    x: number, y: number,
    size: number,
    isBoss: boolean,
    emoji: string = '👾',
): void {
    const sprite = getMonsterSprite(isBoss);

    ctx.save();
    if (sprite) {
        ctx.drawImage(sprite, x - size / 2, y - size / 2, size, size);
    } else {
        ctx.font = `${size * 0.7}px sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(isBoss ? '🐉' : emoji, x, y);
    }
    ctx.restore();
}
