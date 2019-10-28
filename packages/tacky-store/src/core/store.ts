import { Store, DispatchedAction, Mutation, EMaterialType } from '../interfaces';
import { invariant } from '../utils/error';
import { historyCollector } from './collector';
import { nextTick, deduplicate, includes } from '../utils/common';
import * as ReactDOM from 'react-dom';
import { Component } from 'react';
import { ctx } from '../const/config';

export let store: Store;

export function createStore(enhancer: (createStore: any) => Store) {
  if (enhancer !== void 0) {
    store = enhancer(createStore);
    return store;
  }

  const componentUUIDToListeners: WeakMap<Component, Function[]> = new WeakMap();
  let isUpdating: boolean = false;

  function getState(namespace?: string) {
    // invariant(!isUpdating, 'You may not call store.getState() while the mutation/reducer is executing.');

    // if (namespace) {
    //   const atom = DomainStore.globalStateTree[namespace] as AtomStateTree;
    //   return atom.plainObject;
    // }

    // return DomainStore.globalStateTree;
  }

  function subscribe(listener: Function, uuid: Component) {
    let isSubscribed = true;
    const listeners = componentUUIDToListeners.get(uuid);

    if (listeners === void 0) {
      componentUUIDToListeners.set(uuid, [listener]);
    } else {
      if (!includes(listeners, listener)) {
        componentUUIDToListeners.set(uuid, listeners.concat(listener));
      }
    }

    return function unsubscribe() {
      if (!isSubscribed) {
        return;
      }

      isSubscribed = false;

      if (componentUUIDToListeners.has(uuid)) {
        componentUUIDToListeners.delete(uuid);
      }
    }
  }

  let isInBatch: boolean = false;
  let dirtyJob: Function | undefined;
  let isFlushing: boolean = true;

  function dispatch(action: DispatchedAction) {
    /**
     * @todo action name need to record
     */
    const {
      name,
      payload,
      type,
      namespace,
      original,
      isAtom,
    } = action;

    invariant(!isUpdating, 'Cannot trigger other mutation while the current mutation is executing.');

    const callback = () => {
      if (!isFlushing) {
        return;
      }
      if (historyCollector.waitTriggerComponentIds.length > 0) {
        const ids = deduplicate(historyCollector.waitTriggerComponentIds);
        const pendingListeners: Function[] = [];

        for (let index = 0; index < ids.length; index++) {
          const cid = ids[index];
          const listeners = componentUUIDToListeners.get(cid) || [];
          pendingListeners.push(...listeners);
        }

        ReactDOM.unstable_batchedUpdates(() => {
          for (let index = 0; index < pendingListeners.length; index++) {
            const listener = pendingListeners[index];
            listener();
          }
        });
      }
      if (ctx.timeTravel.isActive) {
        historyCollector.save();
      }
      historyCollector.endBatch();
      isInBatch = false;
      dirtyJob = void 0;
    }

    if (isAtom) {
      // immediately flush previous dirty job
      dirtyJob && dirtyJob();
    }

    try {
      isUpdating = true;
      if (type !== EMaterialType.MUTATION && type !== EMaterialType.UPDATE) {
        return;
      }
      const currentMutation = original as Mutation;
      currentMutation(...payload);
    } finally {
      isUpdating = false;
    }

    if (!isInBatch) {
      isInBatch = true;
      isFlushing = true;

      if (isAtom) {
        callback();
        isFlushing = false;
      } else {
        dirtyJob = callback;
        nextTick(callback);
      }
    }

    return action;
  }

  return {
    dispatch,
    subscribe,
    getState,
  };
}
