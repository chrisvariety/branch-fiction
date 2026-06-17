import { useEffect, useState } from 'react';

import type { PickableCharacter } from '@/iframe/db/entities';
import { ensureSchema } from '@/lib/schema';

import { AvatarView } from './screens/AvatarView';
import { ChooseStyle } from './screens/ChooseStyle';
import { PrepareAvatar } from './screens/PrepareAvatar';
import { SelectCharacter } from './screens/SelectCharacter';

type Screen =
  | { name: 'select' }
  | { name: 'style'; character: PickableCharacter }
  | { name: 'prepare'; character: PickableCharacter; generateWith?: string }
  | { name: 'view'; character: PickableCharacter; avatarId: string };

export function App() {
  const [bookId, setBookId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [screen, setScreen] = useState<Screen>({ name: 'select' });

  useEffect(() => {
    window.extensionSDK.onReady(async (ctx) => {
      await ensureSchema(window.extensionSDK.db);
      setBookId(ctx.bookId);
      setReady(true);
    });
  }, []);

  if (!ready) {
    return (
      <div className="grid h-screen place-items-center text-sm opacity-70">Loading…</div>
    );
  }

  if (!bookId) {
    return (
      <div className="grid h-screen place-items-center p-8 text-center text-sm opacity-70">
        Open this extension from a book to bring a character to life.
      </div>
    );
  }

  function selectCharacter(character: PickableCharacter) {
    if (character.runwayAvatarId) {
      setScreen({ name: 'view', character, avatarId: character.runwayAvatarId });
    } else if (character.hasAvatar) {
      setScreen({ name: 'prepare', character });
    } else {
      setScreen({ name: 'style', character });
    }
  }

  if (screen.name === 'view') {
    return (
      <AvatarView
        avatarId={screen.avatarId}
        onExit={() => setScreen({ name: 'select' })}
      />
    );
  }

  if (screen.name === 'style') {
    return (
      <ChooseStyle
        character={screen.character}
        onChoose={(stylePrompt) =>
          setScreen({
            name: 'prepare',
            character: screen.character,
            generateWith: stylePrompt
          })
        }
        onBack={() => setScreen({ name: 'select' })}
      />
    );
  }

  if (screen.name === 'prepare') {
    return (
      <PrepareAvatar
        bookId={bookId}
        character={screen.character}
        generateWith={screen.generateWith}
        onReady={(avatarId) =>
          setScreen({ name: 'view', character: screen.character, avatarId })
        }
        onBack={() => setScreen({ name: 'select' })}
        onChangeStyle={() => setScreen({ name: 'style', character: screen.character })}
      />
    );
  }

  return <SelectCharacter bookId={bookId} onSelect={selectCharacter} />;
}
