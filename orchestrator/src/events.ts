import { EventEmitter } from 'node:events';
import type { SystemEvent } from '@vinted-system/shared';

// Central event bus for SSE broadcasting. Every orchestrator action that
// should be visible to the dashboard pushes a SystemEvent here.
class EventBus extends EventEmitter {
  publish(event: SystemEvent): void {
    this.emit('event', event);
  }
}

export const eventBus = new EventBus();
eventBus.setMaxListeners(100); // allow many dashboard tabs
