// A site's live jobs: not soft-deleted, active and not completed. Once a site has at least
// one, every session there with a time must name a job (draft submit, the inline row editor
// and the Manage Sessions modal); a site with no live jobs keeps sessions job-optional.
// Mirrors the server's siteHasLiveJobs (utils/siteAssignable.js). Only populated jobs count:
// a bare id (an unpopulated response) carries no flags and must never read as a live job.

type SiteJobLike = {
  _id: string
  name: string
  jobCode?: string | null
  isActive?: boolean
  isDeleted?: boolean
  isCompleted?: boolean
}

export const liveSiteJobs = <J extends SiteJobLike>(site: { jobs?: J[] | null } | null | undefined): J[] =>
  (site?.jobs || []).filter((j) => !!j && typeof j === "object" && !j.isDeleted && j.isActive !== false && !j.isCompleted)
