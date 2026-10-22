import { useEffect, useMemo, useRef, useState } from 'react';
import { nextStamp } from '../domain/clock';
import { viewRange } from './calendarModel';
import { deleteRecord, restoreRecord, updateRecord } from '../domain/edit';
import { followed, leaveDays, movedOrder, offTogether, ownPerson } from '../domain/people';
import { addRecord, live, type Follow, type PlanDoc, type RecordContext } from '../domain/schema';
import { displayName } from '../domain/text';
import { useI18n, type MessageKey } from '../i18n';
import type { Storage } from '../storage/Storage';
import type { FollowedState } from '../sync/Followed';
import { MAX_PEOPLE, type OtherPerson } from './Calendar';
import { errorMessage } from './errors';
import type { PersonRow } from './PeoplePanel';
import { useFollowed } from './useFollowed';

/** A message after picking a plan, kept as words to translate, so a language switch translates it too. */
export interface PeopleNote {
  key: MessageKey;
  /** Why the picker failed, translated where it is shown. */
  reason?: MessageKey;
}

interface Options {
  doc: PlanDoc;
  storage: Storage;
  update: (change: (doc: PlanDoc) => PlanDoc) => void;
  recordContext: (doc: PlanDoc) => RecordContext;
  /** My plan's file: never followed, even when a copy of someone's plan names it. */
  ownFileId: string;
  /** My Google account: a plan of that account is mine, whatever its file. */
  mySub?: string;
  personId: string;
  year: number;
  /** Google's picker on plans shared with me; absent in the demo. */
  pick?: (title: string, locale: string) => Promise<{ id: string; name: string } | null>;
  /** Offers to undo an unfollow (the app's undo message). */
  offerUndo: (message: { key: MessageKey; params?: Record<string, string> }, undo: () => void) => void;
}

/**
 * The people whose plans I follow (PPL-3, PPL-4): who they are, how far each plan has loaded,
 * the lines the calendar draws (at most MAX_PEOPLE, in a fixed order) and the days when
 * everyone drawn and I are off. The rules live in domain/people.ts; this wires them to
 * storage and to my plan.
 */
export function usePeople({ doc, storage, update, recordContext, ownFileId, mySub, personId, year, pick, offerUndo }: Options) {
  const { t, name, lang } = useI18n();
  const follows = useMemo(() => followed(doc, ownFileId), [doc, ownFileId]);
  // Only the plans the calendar draws are loaded.
  const drawn = useMemo(() => follows.filter((f) => !f.hidden).slice(0, MAX_PEOPLE), [follows]);
  const plans = useFollowed(
    storage,
    drawn.map((f) => f.driveFileId),
  );
  const [note, setNote] = useState<PeopleNote | null>(null);
  const picking = useRef(false);

  const people = useMemo<PersonRow[]>(() => {
    const byId = new Map(plans.map((p) => [p.calendarId, p]));
    return follows.map((follow) => {
      const plan = byId.get(follow.driveFileId);
      const theirs = plan?.doc;
      const own = theirs && ownPerson(theirs);
      const mine = !!theirs && !!mySub && theirs.owner.googleSub === mySub;
      const state: PersonRow['state'] = follow.hidden
        ? 'hidden'
        : !drawn.includes(follow)
          ? 'tooMany'
          : mine
            ? 'own'
            : ((plan?.state ?? 'loading') satisfies FollowedState);
      return {
        follow,
        name: displayName((own && theirs.people[own]?.name) || follow.label.replace(/\.json$/i, '')) || t('people.unnamed'),
        state,
        ...(plan?.loadedAt !== undefined && { loadedAt: plan.loadedAt }),
      };
    });
  }, [follows, drawn, plans, mySub, t]);

  // A plan that loaded under another name than the one written down (the file's, when it was
  // picked) gets its person's name, so it can be told apart later even if it can't be read.
  useEffect(() => {
    const unnamed = t('people.unnamed');
    const renamed = people.filter((p) => (p.state === 'ready' || p.state === 'stale') && p.name !== p.follow.label && p.name !== unnamed);
    if (renamed.length === 0) return;
    update((d) =>
      renamed.reduce(
        (acc, p) => (acc.following[p.follow.id] ? updateRecord(acc, 'following', p.follow.id, { label: p.name }, nextStamp(acc)) : acc),
        d,
      ),
    );
  }, [people, update, t]);

  const { others, together } = useMemo(() => {
    const view = viewRange(year);
    const byId = new Map(plans.map((p) => [p.calendarId, p]));
    const rows = people.filter((p) => drawn.includes(p.follow));
    const readable = (p: PersonRow) => p.state === 'ready' || p.state === 'stale';
    const lines: OtherPerson[] = rows.map((p) => {
      const theirs = readable(p) ? byId.get(p.follow.driveFileId)?.doc : undefined;
      const own = theirs && ownPerson(theirs);
      return {
        id: p.follow.id,
        name: p.name,
        // Not readable: an empty line keeps everyone else's place.
        days: theirs && own ? leaveDays(theirs, own, view.from, view.to) : new Map(),
        typeName: (day) => (theirs?.leaveTypes[day.block.typeId] ? name(theirs.leaveTypes[day.block.typeId]!.name) : ''),
      };
    });
    // "Everyone" only when everyone drawn is known: one plan still loading or unreadable
    // means nobody can say they are all off.
    const known = rows.length > 0 && rows.every(readable);
    const loaded = known
      ? rows.map((p) => {
          const theirs = byId.get(p.follow.driveFileId)!.doc!;
          return { doc: theirs, personId: ownPerson(theirs)! };
        })
      : [];
    return { others: lines, together: known ? offTogether([{ doc, personId }, ...loaded], view.from, view.to) : undefined };
  }, [people, drawn, plans, year, doc, personId, name]);

  const actions = {
    onToggle: (f: Follow) => update((d) => updateRecord(d, 'following', f.id, { hidden: f.hidden ? undefined : true }, nextStamp(d))),
    onMove: (f: Follow, by: -1 | 1) =>
      update((d) => {
        const order = movedOrder(followed(d, ownFileId), f.id, by);
        return order === undefined ? d : updateRecord(d, 'following', f.id, { order }, nextStamp(d));
      }),
    onUnfollow: (f: Follow) => {
      update((d) => deleteRecord(d, 'following', f.id, nextStamp(d)));
      offerUndo({ key: 'undo.unfollowed', params: { name: displayName(f.label.replace(/\.json$/i, '')) } }, () =>
        update((d) => restoreRecord(d, 'following', f.id, nextStamp(d), f)),
      );
    },
    onFollow: () => {
      // One picker at a time: a double click must not follow the same plan twice.
      if (!pick || picking.current) return;
      picking.current = true;
      setNote(null);
      pick(t('people.pickerTitle'), lang)
        .then(
          (file) => {
            if (!file) return;
            if (file.id === ownFileId) return setNote({ key: 'people.own' });
            update((d) => {
              // Checked against the plan as it is now, not as it was when the picker opened.
              const now = followed(d, ownFileId);
              if (now.some((f) => f.driveFileId === file.id)) return d;
              const last = live(d.following).reduce((m, f) => Math.max(m, f.order ?? 0), 0);
              return addRecord(
                d,
                'following',
                { driveFileId: file.id, label: file.name || file.id, order: Math.floor(last) + 1 },
                recordContext(d),
              ).doc;
            });
            if (follows.some((f) => f.driveFileId === file.id)) setNote({ key: 'people.already' });
          },
          (e: unknown) => setNote({ key: 'people.pickError', reason: errorMessage(e) }),
        )
        .finally(() => (picking.current = false));
    },
  };

  return { people, others, together, note, actions };
}
