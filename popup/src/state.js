/** Mutable popup state */

export let allJobs = [];

export function setAllJobs(jobs) {
  allJobs = jobs;
}

export let bannerTimeout;

export function setBannerTimeout(id) {
  bannerTimeout = id;
}

export function clearBannerTimeout() {
  if (bannerTimeout) {
    window.clearTimeout(bannerTimeout);
    bannerTimeout = undefined;
  }
}
