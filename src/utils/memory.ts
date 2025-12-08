/**
 * Memory utility for localStorage-based persistent memory
 * Storage key format: unicity_agent_memory:${userId}:${activityId}
 *
 * Note: This stores user preferences/memory ONLY, not chat history.
 * Chat history remains in-memory in the useAgentChat hook.
 */

import type { MemoryState } from "../types";

const MEMORY_KEY_PREFIX = 'unicity_agent_memory';

/**
 * Generate storage key for memory data
 */
function getMemoryKey(userId: string, activityId: string): string {
    return `${MEMORY_KEY_PREFIX}:${userId}:${activityId}`;
}

/**
 * Load memory data from localStorage
 * Returns empty object if no data exists or on error
 */
export function loadMemory(userId: string, activityId: string): MemoryState {
    try {
        const key = getMemoryKey(userId, activityId);
        const data = localStorage.getItem(key);

        if (!data) {
            console.log(`[Memory] No stored memory for ${userId}:${activityId}`);
            return {};
        }

        const parsed = JSON.parse(data);
        console.log(`[Memory] Loaded memory for ${userId}:${activityId}:`, Object.keys(parsed));
        return parsed;
    } catch (error) {
        console.warn('[Memory] Failed to load memory:', error);
        return {};
    }
}

/**
 * Save memory data to localStorage
 * Handles quota exceeded errors gracefully
 */
export function saveMemory(
    userId: string,
    activityId: string,
    memoryState: MemoryState
): boolean {
    try {
        const key = getMemoryKey(userId, activityId);
        const data = JSON.stringify(memoryState);

        localStorage.setItem(key, data);
        console.log(`[Memory] Saved memory for ${userId}:${activityId}:`, Object.keys(memoryState));
        return true;
    } catch (error) {
        // Handle quota exceeded errors
        if (error instanceof DOMException &&
            (error.name === 'QuotaExceededError' || error.name === 'NS_ERROR_DOM_QUOTA_REACHED')) {
            console.error('[Memory] localStorage quota exceeded. Unable to save memory.');
        } else {
            console.error('[Memory] Failed to save memory:', error);
        }
        return false;
    }
}

/**
 * Clear memory for a specific user and activity
 */
export function clearMemory(userId: string, activityId: string): void {
    try {
        const key = getMemoryKey(userId, activityId);
        localStorage.removeItem(key);
        console.log(`[Memory] Cleared memory for ${userId}:${activityId}`);
    } catch (error) {
        console.warn('[Memory] Failed to clear memory:', error);
    }
}

/**
 * Check if localStorage is available
 */
export function isLocalStorageAvailable(): boolean {
    try {
        const test = '__localStorage_test__';
        localStorage.setItem(test, test);
        localStorage.removeItem(test);
        return true;
    } catch {
        return false;
    }
}
