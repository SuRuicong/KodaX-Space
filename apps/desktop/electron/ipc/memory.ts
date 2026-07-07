import { registerChannel } from './register.js';
import { memoryGovernanceService } from '../memory/memory-service.js';

export function registerMemoryChannels(): void {
  registerChannel('memory.list', (input) => memoryGovernanceService.list(input));
  registerChannel('memory.proposal', (input) => memoryGovernanceService.proposal(input));
  registerChannel('memory.approve', (input) => memoryGovernanceService.approve(input));
  registerChannel('memory.reject', (input) => memoryGovernanceService.reject(input));
  registerChannel('memory.readRef', (input) => memoryGovernanceService.readRef(input));
  registerChannel('memory.curate', (input) => memoryGovernanceService.curate(input));
  registerChannel('memory.pack', (input) => memoryGovernanceService.pack(input));
}
