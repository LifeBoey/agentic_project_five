// PROVISIONAL: the components every drone model should show, as in the README's data format
// ("what the drone maker buys at tier 1"). A model with no record for one of these shows it grey as
// "Not researched" instead of leaving it out. Magnets and cell materials are deeper tiers of these, not components.
// The list is still open for discussion; changing it here changes the page, the briefs and the data-drop report.
export const EXPECTED_COMPONENTS = ['motors', 'battery cells', 'flight controller chip', 'camera sensor', 'radio'];
