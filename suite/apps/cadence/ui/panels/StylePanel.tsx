import { BUNDLED_FONTS } from "../../assets/fonts";
import type { OutputId } from "../../core/model/types";
import { getDoc, useStore } from "../../state/store";
import { CheckField, ColourField, NumberField, Panel, SelectField } from "@/components/ui/fields";

export function StylePanel() {
  const doc = useStore(getDoc);
  const sheetOutput = useStore((state) => state.ui.sheetOutput);
  const setUi = useStore((state) => state.setUi);
  const setStyle = useStore((state) => state.setStyle);

  const style = doc.styles[sheetOutput];
  const families = [
    ...BUNDLED_FONTS.map((font) => font.family),
    ...doc.fonts.map((font) => font.family),
  ];

  return (
    <Panel title="Design">
      <SelectField
        label="Printed piece"
        value={sheetOutput}
        options={doc.outputs.map((output) => ({ value: output.id, label: output.label }))}
        onChange={(id: OutputId) => setUi({ sheetOutput: id })}
      />

      <SelectField
        label="Font"
        value={style.fontFamily}
        options={[...new Set(families)].map((family) => ({ value: family, label: family }))}
        onChange={(fontFamily) => setStyle(sheetOutput, { fontFamily })}
      />

      <NumberField
        label="Type size"
        value={style.typeScale}
        min={0.7}
        max={1.8}
        step={0.05}
        suffix="×"
        onChange={(typeScale) => setStyle(sheetOutput, { typeScale })}
      />

      <NumberField
        label="Rule weight"
        value={style.ruleWeightPt}
        min={0}
        max={3}
        step={0.25}
        suffix="pt"
        onChange={(ruleWeightPt) => setStyle(sheetOutput, { ruleWeightPt })}
      />

      <ColourField
        label="Accent"
        value={style.accentHex}
        onChange={(accentHex) => setStyle(sheetOutput, { accentHex })}
      />

      <CheckField
        label="Show the logo"
        checked={style.showLogo}
        onChange={(showLogo) => setStyle(sheetOutput, { showLogo })}
      />
    </Panel>
  );
}
