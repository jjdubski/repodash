// fallow-ignore-file unused-file
'use strict';

import {
  filterByDate,
  computeFilteredSummary,
  computeFilteredContributors,
  computeFilteredActivity,
  downsampleData,
  MAX_CHART_POINTS,
  sortContributors,
  getCutoffDate
} from './filter.js';

let rawData = null;

globalThis.onmessage = function (e) {
  const msg = e.data;

  switch (msg.type) {
    case 'init':
      rawData = {
        contributions: msg.data.contributions,
        contributors: msg.data.contributors,
        frequency: msg.data.frequency,
        summary: msg.data.summary
      };
      self.postMessage({ type: 'ready' });
      break;

    case 'filter': {
      if (!rawData) {
        self.postMessage({ type: 'error', requestId: msg.requestId, message: 'Not initialized' });
        return;
      }

      const bounds = getCutoffDate(msg.filter, msg.customStartDate, msg.customEndDate);

      const filteredContributions = filterByDate(rawData.contributions, bounds);
      const filteredFrequency = filterByDate(rawData.frequency, bounds);

      const result = {};

      result.contributions = downsampleData(filteredContributions, MAX_CHART_POINTS);

      if (msg.activeTab === 'overview') {
        result.summary = computeFilteredSummary(filteredContributions, filteredFrequency);
        result.contributors = computeFilteredContributors(
          filteredContributions,
          rawData.contributors
        );
        result.frequency = downsampleData(filteredFrequency, MAX_CHART_POINTS);
      } else if (msg.activeTab === 'contributors') {
        result.contributors = computeFilteredContributors(
          filteredContributions,
          rawData.contributors
        );
        if (msg.sortBy) {
          result.contributors = sortContributors(result.contributors, msg.sortBy, msg.sortOrder);
        }
      } else if (msg.activeTab === 'activity') {
        result.activity = computeFilteredActivity(filteredContributions);
        result.fullContributions = filteredContributions;
        result.contributors = computeFilteredContributors(
          filteredContributions,
          rawData.contributors
        );
      }

      self.postMessage({ type: 'result', requestId: msg.requestId, data: result });
      break;
    }

    case 'reset':
      rawData = null;
      self.postMessage({ type: 'ready' });
      break;
  }
};
