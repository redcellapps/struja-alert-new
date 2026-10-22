import { useState } from 'react';
import { View } from 'react-native';
import {
  Button,
  CheckboxRow,
  Chip,
  RadioRow,
  RangeChips,
  SectionHeader,
  Segmented,
  SwitchRow,
  TimelineBar,
} from '../design/components';

type Pismo = 'latin' | 'cyrillic';
type Tema = 'system' | 'light' | 'dark';

/** Radio rows, checkboxes, switches, segmented controls, buttons, chips, range chips, timeline. */
export function Controls() {
  const [radio, setRadio] = useState('evening');
  const [checks, setChecks] = useState({ new: true, changed: true, cancelled: false });
  const [sw, setSw] = useState({ push: true, quiet: false });
  const [script, setScript] = useState<Pismo>('latin');
  const [theme, setTheme] = useState<Tema>('system');
  const [label, setLabel] = useState('home');
  return (
    <View style={{ gap: 28 }}>
      <View style={{ gap: 12 }}>
        <SectionHeader title="Dugmad" />
        <Button label="Sačuvaj adresu" />
        <Button label="Dodaj adresu" variant="secondary" fullWidth />
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <Button label="Ne sada" variant="text" />
          <Button label="Sačuvaj adresu" disabled fullWidth />
        </View>
      </View>

      <View style={{ gap: 12 }}>
        <SectionHeader title="Kada da vas podsetimo" />
        <RadioRow
          label="Uveče pre isključenja"
          description="Oko 19:00, dan ranije"
          selected={radio === 'evening'}
          onSelect={() => setRadio('evening')}
        />
        <RadioRow
          label="Sat vremena ranije"
          selected={radio === 'hour'}
          onSelect={() => setRadio('hour')}
        />
        <RadioRow
          label="Bez podsetnika"
          selected={radio === 'none'}
          onSelect={() => setRadio('none')}
        />
      </View>

      <View style={{ gap: 4 }}>
        <SectionHeader title="Vrste obaveštenja" />
        <CheckboxRow
          label="Nova isključenja"
          checked={checks.new}
          onChange={(v) => setChecks({ ...checks, new: v })}
        />
        <CheckboxRow
          label="Izmene"
          description="Kada se promeni vreme isključenja"
          checked={checks.changed}
          onChange={(v) => setChecks({ ...checks, changed: v })}
        />
        <CheckboxRow
          label="Otkazivanja"
          checked={checks.cancelled}
          onChange={(v) => setChecks({ ...checks, cancelled: v })}
        />
      </View>

      <View style={{ gap: 12 }}>
        <SectionHeader title="Obaveštenja" />
        <SwitchRow
          label="Obaveštenja"
          description="Najave za vaše adrese"
          value={sw.push}
          onChange={(v) => setSw({ ...sw, push: v })}
        />
        <SwitchRow
          label="Tihi sati"
          description="22:00–07:00"
          value={sw.quiet}
          onChange={(v) => setSw({ ...sw, quiet: v })}
        />
      </View>

      <View style={{ gap: 12 }}>
        <SectionHeader title="Pismo i tema" />
        <Segmented
          accessibilityLabel="Pismo"
          value={script}
          onChange={setScript}
          options={[
            { value: 'latin', label: 'Latinica' },
            { value: 'cyrillic', label: 'Ћирилица' },
          ]}
        />
        <Segmented
          accessibilityLabel="Tema"
          value={theme}
          onChange={setTheme}
          options={[
            { value: 'system', label: 'Sistem' },
            { value: 'light', label: 'Svetla' },
            { value: 'dark', label: 'Tamna' },
          ]}
        />
      </View>

      <View style={{ gap: 12 }}>
        <SectionHeader title="Oznaka adrese" />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {(
            [
              ['home', 'Kuća'],
              ['work', 'Posao'],
              ['parents', 'Roditelji'],
              ['custom', 'Drugo'],
            ] as const
          ).map(([k, text]) => (
            <Chip key={k} label={text} selected={label === k} onPress={() => setLabel(k)} />
          ))}
        </View>
      </View>

      <View style={{ gap: 12 }}>
        <SectionHeader title="Pogođene ulice" />
        <RangeChips
          ranges={[
            { label: 'neparni 1–25' },
            { label: '26–40', contains: true },
            { label: 'parni 42–60' },
            { label: 'cela ulica' },
          ]}
          note="Vaš broj 34 je u opsegu 26–40"
        />
      </View>

      <View style={{ gap: 16 }}>
        <SectionHeader title="24 h" />
        <TimelineBar
          startHour={8.5}
          endHour={12.5}
          nowHour={7.2}
          status="imminent"
          accessibilityLabel="Isključenje od 8:30 do 12:30, sada je 7:12"
        />
        <TimelineBar
          startHour={8.5}
          endHour={12.5}
          nowHour={10.4}
          status="active"
          accessibilityLabel="Isključenje od 8:30 do 12:30, sada je 10:24"
        />
      </View>
    </View>
  );
}
