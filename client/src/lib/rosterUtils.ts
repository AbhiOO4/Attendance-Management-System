// Shared roster-category helpers. The four categories are collarType × nationality.
// Foreign categories are shown with a ✈️ plane marker; Omani ones are labelled
// "Omani …". collarType/nationality default to skilled/foreign for older data.
// Kept in sync with the server's model comment (server/src/models/empModel.js).

export type CollarType = 'skilled' | 'staff'
export type Nationality = 'foreign' | 'omani'

export type RosterCategory =
  | 'foreignSkilled'
  | 'foreignStaff'
  | 'omaniSkilled'
  | 'omaniStaff'

export const categoryOf = (
  collarType?: CollarType | null,
  nationality?: Nationality | string | null
): RosterCategory => {
  const staff = collarType === 'staff'
  const omani = nationality === 'omani'
  return omani
    ? (staff ? 'omaniStaff' : 'omaniSkilled')
    : (staff ? 'foreignStaff' : 'foreignSkilled')
}

export const CATEGORY_LABELS: Record<RosterCategory, string> = {
  foreignSkilled: 'Skilled Labour',
  foreignStaff: 'Staff',
  omaniSkilled: 'Omani Labour',
  omaniStaff: 'Omani Staff',
}

export const CATEGORY_IS_FOREIGN: Record<RosterCategory, boolean> = {
  foreignSkilled: true,
  foreignStaff: true,
  omaniSkilled: false,
  omaniStaff: false,
}
