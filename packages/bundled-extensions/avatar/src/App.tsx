import type { SessionCredentials } from '@runwayml/avatars-react';
import { useEffect, useState } from 'react';

import type { PickableCharacter } from '@/iframe/db/entities';
import type { AvatarScenario } from '@/lib/db/types';
import { ensureSchema } from '@/lib/schema';

import { AvatarView } from './screens/AvatarView';
import { ChooseStyle } from './screens/ChooseStyle';
import { PrepareAvatar } from './screens/PrepareAvatar';
import { SelectCharacter } from './screens/SelectCharacter';
import { SelectScenario } from './screens/SelectScenario';

type Screen =
  | { name: 'select' }
  | { name: 'style'; character: PickableCharacter }
  | { name: 'prepare'; character: PickableCharacter; generateWith?: string }
  | { name: 'scenario'; character: PickableCharacter; avatarId: string }
  | {
      name: 'view';
      character: PickableCharacter;
      avatarId: string;
      scenario: AvatarScenario | null;
      credentials: SessionCredentials;
    };

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
      setScreen({ name: 'scenario', character, avatarId: character.runwayAvatarId });
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
        characterName={screen.character.name}
        scenario={screen.scenario}
        initialCredentials={screen.credentials}
        onExit={() => setScreen({ name: 'select' })}
      />
    );
  }

  if (screen.name === 'scenario') {
    return (
      <SelectScenario
        bookId={bookId}
        character={screen.character}
        avatarId={screen.avatarId}
        onStarted={(credentials, scenario) =>
          setScreen({
            name: 'view',
            character: screen.character,
            avatarId: screen.avatarId,
            scenario,
            credentials
          })
        }
        onBack={() => setScreen({ name: 'select' })}
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
          setScreen({ name: 'scenario', character: screen.character, avatarId })
        }
        onBack={() => setScreen({ name: 'select' })}
        onChangeStyle={() => setScreen({ name: 'style', character: screen.character })}
      />
    );
  }

  return <SelectCharacter bookId={bookId} onSelect={selectCharacter} />;
}
