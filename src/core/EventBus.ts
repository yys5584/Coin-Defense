// ============================================================
// EventBus — 발행/구독 이벤트 시스템
// 모듈 간 느슨한 결합. 렌더링 무관.
// Unity: C# event / UnityEvent로 변환
// ============================================================

import { GameEventType, GameEvent } from './types';

type EventHandler = (event: GameEvent) => void;

export class EventBus {
    private listeners: Map<GameEventType, Set<EventHandler>> = new Map();

    /** 이벤트 구독 */
    on(type: GameEventType, handler: EventHandler): void {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, new Set());
        }
        this.listeners.get(type)!.add(handler);
    }

    /** 이벤트 구독 해제 */
    off(type: GameEventType, handler: EventHandler): void {
        this.listeners.get(type)?.delete(handler);
    }

    /** 이벤트 발행 */
    emit(type: GameEventType, data?: unknown): void {
        const event: GameEvent = {
            type,
            data,
            timestamp: Date.now(),
        };
        this.listeners.get(type)?.forEach(handler => {
            try {
                handler(event);
            } catch (e) {
                console.error(`[EventBus] Error in handler for ${type}:`, e);
            }
        });
    }

    /** 한 번만 실행되는 구독 */
    once(type: GameEventType, handler: EventHandler): void {
        const wrapper: EventHandler = (event) => {
            this.off(type, wrapper);
            handler(event);
        };
        this.on(type, wrapper);
    }

    /** 모든 구독 해제 */
    clear(): void {
        this.listeners.clear();
    }
}
