import type {WorkerGlobalScopeInterface} from '../../../src/util/web_worker';
import type {ActorTarget} from '../../../src/util/actor';
import MapLibreWorker from '../../../src/source/worker';

export class MessageBus implements WorkerGlobalScopeInterface, ActorTarget {
    addListeners: Array<EventListener>;
    postListeners: Array<EventListener>;
    target: MessageBus;
    registerWorkerSource: any;
    registerRTLTextPlugin: any;

    constructor(addListeners: Array<EventListener>, postListeners: Array<EventListener>) {
        this.addListeners = addListeners;
        this.postListeners = postListeners;
    }

    addEventListener(event: 'message', callback: EventListener) {
        if (event === 'message') {
            this.addListeners.push(callback);
        }
    }

    removeEventListener(event: 'message', callback: EventListener) {
        const i = this.addListeners.indexOf(callback);
        if (i >= 0) {
            this.addListeners.splice(i, 1);
        }
    }

    postMessage(data: any) {
        setTimeout(() => {
            try {
                for (const listener of this.postListeners) {
                    listener({data, target: this.target} as any);
                }
            } catch (e) {
                console.error(e);
            }
        }, 0);
    }

    terminate() {
        this.addListeners.splice(0, this.addListeners.length);
        this.postListeners.splice(0, this.postListeners.length);
    }

    importScripts() { }
}

(global as any).Worker = function Worker(_: string) {
    const parentListeners = [];
    const workerListeners = [];
    const parentBus = new MessageBus(workerListeners, parentListeners);
    const workerBus = new MessageBus(parentListeners, workerListeners);

    parentBus.target = workerBus;
    workerBus.target = parentBus;

    new MapLibreWorker(workerBus);

    return parentBus;
};
