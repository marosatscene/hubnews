const { sourceRepo } = require("./repositories");

const initialSources = [
  {
    name: "Gazeta Wyborcza",
    homepageUrl: "https://wyborcza.pl",
    language: "pl",
    country: "PL"
  },
  {
    name: "Rzeczpospolita",
    homepageUrl: "https://www.rp.pl",
    language: "pl",
    country: "PL"
  },
  {
    name: "TVN24",
    homepageUrl: "https://tvn24.pl",
    language: "pl",
    country: "PL"
  },
  {
    name: "TVP",
    homepageUrl: "https://www.tvp.pl",
    language: "pl",
    country: "PL"
  },
  {
    name: "BBC News",
    homepageUrl: "https://www.bbc.com/news",
    feedUrl: "https://feeds.bbci.co.uk/news/rss.xml",
    language: "en",
    country: "GB"
  },
  {
    name: "The Guardian",
    homepageUrl: "https://www.theguardian.com",
    language: "en",
    country: "GB"
  },
  {
    name: "The Times",
    homepageUrl: "https://www.thetimes.co.uk",
    language: "en",
    country: "GB"
  },
  {
    name: "Financial Times",
    homepageUrl: "https://www.ft.com",
    language: "en",
    country: "GB"
  },
  {
    name: "Daily Mail",
    homepageUrl: "https://www.dailymail.co.uk",
    language: "en",
    country: "GB"
  },
  {
    name: "Reuters",
    homepageUrl: "https://www.reuters.com",
    language: "en",
    country: "US"
  },
  {
    name: "Press Association",
    homepageUrl: "https://www.pressassociation.com",
    language: "en",
    country: "GB"
  },
  {
    name: "PAP",
    homepageUrl: "https://www.pap.pl",
    language: "pl",
    country: "PL"
  }
];

async function seed() {
  for (const source of initialSources) {
    await sourceRepo.upsertSource(source);
  }
  console.log(`Seeded ${initialSources.length} sources`);
}

if (require.main === module) {
  seed().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

module.exports = { seed, initialSources };
