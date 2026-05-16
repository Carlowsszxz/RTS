# Phase-by-Phase Execution Plan

**Total Phases**: 4  
**Estimated Time**: 2-3 hours  
**Risk Level**: Low (mostly cosmetic + logic improvements)

---

## 🟢 PHASE 1: Critical Timing Fixes (30 minutes)

**Objective**: Fix the two timing mismatches that cause UX confusion

### Task 1.1: Fix Presence Prompt Timing
- **File**: [src/pages/DashboardPage.tsx](src/pages/DashboardPage.tsx#L143)
- **Change**: `promptIntervalMs = 5 * 60 * 1000` → `promptIntervalMs = 10 * 60 * 1000`
- **Validation**: 
  - Prompt appears exactly 10 minutes after last motion
  - Not before
- **Test**: Create a session, wait for prompt at 10:00 mark (use mock time)

### Task 1.2: Fix Override Poll Timing Label
- **File**: [src/pages/AdminPage.tsx](src/pages/AdminPage.tsx#L60)
- **Change**: Message says "checks every 1s" → "checks every 5s"
- **Validation**: User sets override, warning shows accurate expectation
- **Test**: Manual - click override, observe message

### Acceptance Criteria
- ✓ Dashboard waits full 10 minutes for prompt
- ✓ AdminPage warning says "5s"
- ✓ Both changes verified in code review

**Effort**: 5 minutes code change + 5 minutes testing

---

## 🟡 PHASE 2: State Sync & Freshness Detection (45 minutes)

**Objective**: Improve UX by detecting stale data and syncing session state properly

### Task 2.1: Add Stale Data Detection
- **File**: [src/pages/DashboardPage.tsx](src/pages/DashboardPage.tsx)
- **Changes**:
  ```typescript
  // Add freshness calculation
  const stalethresholdMs = 30000; // 30 seconds
  const latestSensorMs = latestSensorEvent ? new Date(latestSensorEvent.timestamp).getTime() : null;
  const ageMs = latestSensorMs ? now.getTime() - latestSensorMs : Infinity;
  const isStale = ageMs > staleThresholdMs;
  
  // Render indicator
  {isStale && (
    <div className='bg-yellow-100 border-yellow-500 px-3 py-2 rounded'>
      ⚠️ Data may be outdated (last update {Math.round(ageMs/1000)}s ago)
    </div>
  )}
  ```
- **Validation**: Verify stale warning appears after 30 seconds of no new events

### Task 2.2: Disable Override Controls When Stale
- **File**: [src/pages/AdminPage.tsx](src/pages/AdminPage.tsx)
- **Changes**:
  ```typescript
  // Calculate staleness
  const staleMs = latestSensorEvent ? now.getTime() - new Date(latestSensorEvent.timestamp).getTime() : Infinity;
  const isStale = staleMs > 30000;
  
  // Disable buttons
  <NeoButton ... disabled={isStale} title={isStale ? "Data stale, cannot override" : ""} />
  ```
- **Validation**: Override buttons disabled after 30s without new sensor data

### Task 2.3: Sync Session Timeout State
- **File**: [src/pages/DashboardPage.tsx](src/pages/DashboardPage.tsx)
- **Changes**:
  ```typescript
  // Track when last prompt was sent
  const lastPromptEvent = presenceEvents.find(e => e.event === 'still_there_prompt');
  const promptSentMs = lastPromptEvent ? new Date(lastPromptEvent.timestamp).getTime() : 0;
  const timeoutMs = 5 * 60 * 1000; // 5 min timeout
  
  // Auto-clear session if timeout expired without ACK
  const shouldAutoCancel = lastPromptEvent && !presenceEvents.some(e => 
    e.event === 'still_there_ack' && new Date(e.timestamp).getTime() > promptSentMs
  ) && now.getTime() - promptSentMs > timeoutMs;
  
  // Use shouldAutoCancel in UI decision
  ```
- **Validation**: After 10+5 min idle without ACK, UI shows session as "Expired"

### Acceptance Criteria
- ✓ Stale warning appears after 30s
- ✓ Override buttons disabled when stale
- ✓ Session auto-clears after timeout
- ✓ No console errors

**Effort**: 20 minutes code + 15 minutes testing

---

## 🟠 PHASE 3: Architecture Improvements (30 minutes)

**Objective**: Fix multi-device support and add missing ACK functionality

### Task 3.1: Update useSupabaseLogs for Multi-Device
- **File**: [src/hooks/useSupabaseLogs.ts](src/hooks/useSupabaseLogs.ts)
- **Changes**:
  ```typescript
  export function useSupabaseLogs(userId?: string | null, deviceId?: string | null) {
    // ... existing code ...
    
    const query = supabase.from('session_logs').select(...)
      .eq('user_id', userId);
    
    if (deviceId) {
      query = query.eq('device_id', deviceId);  // ADD THIS
    }
    
    const { data, error } = await query...
  ```
- **Validation**: Verify logs filter by device_id when provided
- **Update App.tsx**: Pass deviceId to useSupabaseLogs
  ```typescript
  const { logs: supabaseLogs } = useSupabaseLogs(currentUserId, deviceId)
  ```

### Task 3.2: Create useSupabaseAckPresence Hook
- **File**: Create new [src/hooks/useSupabaseAckPresence.ts](src/hooks/useSupabaseAckPresence.ts)
- **Code**:
  ```typescript
  export async function acknowledgePresence(deviceId: string): Promise<boolean> {
    try {
      const { error } = await supabase
        .from('presence_acks')
        .insert({
          device_id: deviceId,
          ack_at: new Date().toISOString(),
        });
      
      return !error;
    } catch (err) {
      console.error('ACK presence failed:', err);
      return false;
    }
  }
  ```
- **Validation**: Manual test - call from Dashboard button, verify ack is inserted

### Task 3.3: Wire Confirm Presence Button
- **File**: [src/pages/DashboardPage.tsx](src/pages/DashboardPage.tsx)
- **Changes**:
  ```typescript
  // In props, add callback
  const onConfirmPresence = async () => {
    if (!deviceId) return;
    const ok = await acknowledgePresence(deviceId);
    if (ok) {
      notify('Presence confirmed', 'success');
    } else {
      notify('Failed to confirm presence', 'warning');
    }
  };
  
  // Pass to button
  <button onClick={onConfirmPresence}>Confirm Presence</button>
  ```
- **Validation**: Click button → presence_acks entry created in Supabase

### Acceptance Criteria
- ✓ useSupabaseLogs filters by device_id correctly
- ✓ acknowledgePresence inserts into presence_acks
- ✓ Confirm button creates ACK and notifies user
- ✓ No errors when deviceId is null

**Effort**: 15 minutes code + 10 minutes testing

---

## 🟡 PHASE 4: Polish & Validation (15 minutes)

**Objective**: Final verification and documentation

### Task 4.1: Update Comments & Labels
- Find all hardcoded timing values and add comments referencing Arduino spec
- Example: `// Arduino polls every 5 seconds (OVERRIDE_POLL_INTERVAL_MS)`
- Files to check:
  - [src/pages/AdminPage.tsx](src/pages/AdminPage.tsx)
  - [src/pages/DashboardPage.tsx](src/pages/DashboardPage.tsx)

### Task 4.2: Add Error Logging
- Add console warnings for:
  - Stale data detected
  - Override failed to post
  - ACK failed to insert
  - Missing sensor events

### Task 4.3: Test Full Integration
- [ ] Motion detected → sensor_events POSTed to Supabase
- [ ] Wait 10 minutes → prompt appears
- [ ] Click override → SSR changes within 5 seconds
- [ ] Confirm presence → ACK inserted
- [ ] No data 30s → warning shows
- [ ] After timeout → session auto-cancels
- [ ] Multi-device: Filter logs correctly

### Task 4.4: Documentation
- [ ] Update README with timing expectations
- [ ] Add comment block to App.tsx explaining data flow
- [ ] Update PR description with spec compliance

### Acceptance Criteria
- ✓ All timing comments accurate
- ✓ Error logging added
- ✓ Full integration test passes
- ✓ Code reviewed against websiteprocess.md spec

**Effort**: 10 minutes + 5 minutes spot-checks

---

## 📊 Execution Timeline

```
Phase 1 (Critical Fixes)      [████░░░░░░] 30 min
Phase 2 (State Sync)          [�усемема░░░░] 45 min
Phase 3 (Architecture)        [╬╬░░░░░░░] 30 min
Phase 4 (Polish)              [█░░░░░░░░░] 15 min

Total: ~2 hours
```

---

## Risk Assessment

### Low Risk (Phase 1)
- Simple constant change
- No logic modifications
- Non-breaking

### Medium Risk (Phase 2)
- Adds new UI state tracking
- Depends on timestamp accuracy
- Mitigation: Easy to revert, UI-only

### Low-Medium Risk (Phase 3)
- Database changes, but backward compatible
- New hook doesn't affect existing code paths
- Mitigation: Feature-flag if needed

### Low Risk (Phase 4)
- Documentation and logging only
- No functional changes
- Mitigation: Can skip if time-pressed

---

## Rollback Plan

Each phase is independently reversible:

1. **Phase 1**: Revert constants to original values
2. **Phase 2**: Remove staleness checks (won't error)
3. **Phase 3**: Keep deviceId filter optional (backward compatible)
4. **Phase 4**: Just remove comment changes

No database migrations needed.

---

## Success Criteria

After all phases complete, verify against spec:
- ✓ [websiteprocess.md Section 2](src/others/websiteprocess.md#L218): Real-time data flow correct
- ✓ [websiteprocess.md Section 3](src/others/websiteprocess.md#L315): Control flow 0-5s → SSR changes
- ✓ [websiteprocess.md Section 6](src/others/websiteprocess.md#L510): Timing expectations met
- ✓ [websiteprocess.md Section 7](src/others/websiteprocess.md#L565): State management synchronized
- ✓ [websiteprocess.md Section 8](src/others/websiteprocess.md#L665): Error cases handled

---

## Recommended Execution Order

**Option A: Conservative** (Recommended)
1. Phase 1 (fix + test) 
2. Phase 4 (document)
3. Deploy
4. Phase 2 (enhancement, next sprint)
5. Phase 3 (architecture, when multi-device needed)

**Option B: Comprehensive** (If time available)
1. All phases → 2 hours total
2. Full integration test
3. Deploy whole solution

---

## Next Steps

1. Choose execution option (A or B)
2. Assign developer to each phase
3. Run Phase 1 immediately (30 min break-fix)
4. Schedule Phases 2-4 for sprint planning
5. Update sprint board with these tasks

