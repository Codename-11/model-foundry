export const BENCHMARK_SCORE_LABEL = 'Benchmark Score';

export const BENCHMARK_SCORE_DESCRIPTION = 'Repo-maintained benchmark-derived quality proxy used as the quality anchor for routing. It is combined with live latency and availability rather than used alone.';

export const BENCHMARK_SCORE_PROVENANCE = {
  currentReference: {
    title: 'Current Score Reference',
    summary: 'Today, ModelFoundry uses the repo-maintained score map in scores.js as its normalized benchmark-quality reference.',
  },
  note: 'Where structured rows are available, the UI now shows source-specific benchmark values. The broader benchmark families below remain the official sources we want to ingest more directly over time.',
};

export const BENCHMARK_SOURCE_GROUPS = [
  {
    id: 'coding',
    title: 'Coding Capability',
    sources: [
      {
        key: 'swebench',
        title: 'SWE-bench Verified',
        shortLabel: 'Real-world issue resolution',
        url: 'https://www.swebench.com/',
      },
      {
        key: 'livecodebench',
        title: 'LiveCodeBench',
        shortLabel: 'Contamination-resistant coding benchmark',
        url: 'https://livecodebench.github.io/',
      },
      {
        key: 'livebench-coding',
        title: 'LiveBench Coding',
        shortLabel: 'Fresh coding and agentic evaluation slices',
        url: 'https://livebench.ai/',
      },
    ],
  },
  {
    id: 'general',
    title: 'General Use / Reasoning',
    sources: [
      {
        key: 'mmlu-pro',
        title: 'MMLU-Pro',
        shortLabel: 'General knowledge and reasoning',
        url: 'https://arxiv.org/abs/2406.01574',
      },
      {
        key: 'gpqa',
        title: 'GPQA',
        shortLabel: 'Expert-level science reasoning',
        url: 'https://arxiv.org/abs/2311.12022',
      },
      {
        key: 'lm-arena',
        title: 'LM Arena',
        shortLabel: 'Preference-style general-use leaderboard',
        url: 'https://lmarena.ai/',
      },
    ],
  },
];
