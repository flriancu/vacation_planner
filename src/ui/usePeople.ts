import { useMemo, useRef, useState } from 'react';
import { nextStamp } from '../domain/clock';
import { viewRange } from './calendarModel';
import { deleteRecord, restoreRecord, updateRecord } from '../domain/edit';
import { followed, isFileId, leaveDays, movedOrder, offTogether, ownPerson } from '../domain/people';
import { addRecord, type Follow, type PlanDoc, type RecordContext } from '../domain/schema';
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
  /** Signs in to Google again (the session ended); absent in the demo. */
  reconnect?: () => Promise<unknown>;
  /** Offers to undo an unfollow (the app's undo message). */
  offerUndo: (message: { key: MessageKey; params?: Record<string, string> }, undo: () => void) => void;
}

/**
 * The people whose plans I follow (PPL-3, PPL-4): who they are, how far each plan has loaded,
 * the lines the calendar draws (at most MAX_PEOPLE, in a fixed order) and the days when
 * everyone drawn and I are off. The rules live in domain/people.ts; this wires them to
 * storage and to my plan. Their names are never written into my plan: anyone I share it with
 * could read them there.
 */
export function usePeople({ doc, storage, update, recordContext, ownFileId, mySub, personId, year, pick, reconnect, offerUndo }: Options) {
  const { t, name, lang } = useI18n();
  const follows = useMemo(() => followed(doc, ownFileId), [doc, ownFileId]);
  // Only the plans the calendar draws are loaded.
  const drawn = useMemo(() => follows.filter((f) => !f.hidden).slice(0, MAX_PEOPLE), [follows]);
  const { plans, refresh } = useFollowed(
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
      // Unread, a plan has only its file's name (nearly always "vacation-planner"): the end
      // of its file id tells two such apart.
      const fileName = `${displayName(follow.label.replace(/\.json$/i, '')) || t('people.unnamed')} (…${follow.driveFileId.slice(-4)})`;
      return {
        follow,
        name: (own && displayName(theirs.people[own]?.name ?? '')) || fileName,
        state,
        ...(plan?.loadedAt !== undefined && { loadedAt: plan.loadedAt }),
      };
    });
  }, [follows, drawn, plans, mySub, t]);

  const { others, together, waiting } = useMemo(() => {
    const view = viewRange(year);
    const byId = new Map(plans.map((p) => [p.calendarId, p]));
    // A copy of my own plan is not drawn and takes no line.
    const rows = people.filter((p) => drawn.includes(p.follow) && p.state !== 'own');
    const readable = (p: PersonRow) => p.state === 'ready' || p.state === 'stale';
    const lines: OtherPerson[] = rows.map((p) => {
      const theirs = readable(p) ? byId.get(p.follow.driveFileId)?.doc : undefined;
      const own = theirs && ownPerson(theirs);
      return {
        id: p.follow.id,
        name: p.name,
        // Not readable: an empty line keeps everyone else's place.
        days: theirs && own ? leaveDays(theirs, own, view.from, view.to) : new Map(),
        ...(!theirs && { unknown: true }),
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
    return {
      others: lines,
      together: known ? offTogether([{ doc, personId }, ...loaded], view.from, view.to) : undefined,
      waiting: rows.length > 0 && !known,
    };
  }, [people, drawn, plans, year, doc, personId, name]);

  const actions = {
    onToggle: (f: Follow) => update((d) => updateRecord(d, 'following', f.id, { hidden: f.hidden ? undefined : true }, nextStamp(d))),
    onMove: (f: Follow, by: -1 | 1) =>
      update((d) => {
        const order = movedOrder(followed(d, ownFileId), f.id, by);
        return order === undefined ? d : updateRecord(d, 'following', f.id, { order }, nextStamp(d));
      }),
    onUnfollow: (f: Follow, shownName: string) => {
      update((d) => deleteRecord(d, 'following', f.id, nextStamp(d)));
      // Undo brings it back as it is then (a hide from another device meanwhile stays).
      offerUndo({ key: 'undo.unfollowed', params: { name: shownName } }, () =>
        update((d) => restoreRecord(d, 'following', f.id, nextStamp(d), d.following[f.id] ?? f)),
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
            if (!isFileId(file.id)) return setNote({ key: 'people.notFile' });
            if (follows.some((f) => f.driveFileId === file.id)) return setNote({ key: 'people.already' });
            update((d) =>
              // Checked against the plan as it is now, not as it was when the picker opened.
              // No place given: it goes last, in the order I started following.
              followed(d, ownFileId).some((f) => f.driveFileId === file.id)
                ? d
                : addRecord(d, 'following', { driveFileId: file.id, label: file.name || file.id }, recordContext(d)).doc,
            );
          },
          (e: unknown) => setNote({ key: 'people.pickError', reason: errorMessage(e) }),
        )
        .finally(() => (picking.current = false));
    },
    // Signing in again also loads the plans that were waiting for it.
    ...(reconnect && { onSignIn: () => void reconnect().then(refresh) }),
  };

  return { people, others, together, waiting, note, actions };
}
