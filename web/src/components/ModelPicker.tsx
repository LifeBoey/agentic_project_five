export function ModelPicker({ models, value, onChange }: {
  models: string[];
  value: string;
  onChange: (m: string) => void;
}) {
  return (
    <label className="picker">
      <span>Drone model</span>
      <select value={value} onChange={e => onChange(e.target.value)}>
        {models.map(m => <option key={m} value={m}>{m}</option>)}
      </select>
    </label>
  );
}
