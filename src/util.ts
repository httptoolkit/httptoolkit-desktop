// Taken from HTTP Toolkit UI's util/promise.ts:

export interface Deferred<T> {
    resolve: (arg: T) => void,
    reject: (e?: Error) => void,
    promise: Promise<T>
}

export function getDeferred<T = void>(): Deferred<T> {
    let resolve: undefined | ((arg: T) => void) = undefined;
    let reject: undefined | ((e?: Error) => void) = undefined;

    let promise = new Promise<T>((resolveCb, rejectCb) => {
        resolve = resolveCb;
        reject = rejectCb;
    });

    // TS thinks we're using these before they're assigned, which is why
    // we need the undefined types, and the any here.
    return { resolve, reject, promise } as any;
}

export const delay = (delayMs: number) => new Promise<void>((resolve) => setTimeout(resolve, delayMs));

export class UnreachableCheck extends Error {

    // getValue is used to allow logging properties (e.g. v.type) on expected-unreachable
    // values, instead of just logging [object Object].
    constructor(value: never, getValue: (v: any) => any = (x => x)) {
        super(`Unhandled case value: ${getValue(value)}`);
    }

}