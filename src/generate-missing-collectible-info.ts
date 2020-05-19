import { getAll, loadLocal } from 'destiny2-manifest/node';
import { sortObject, writeFile } from './helpers';

import categories from '../data/sources/categories.json';
import stringifyObject from 'stringify-object';
import { uniqAndSortArray, annotate } from './helpers.js';

interface Categories {
  sources: Record<
    string,
    {
      includes: string[];
      excludes?: string[];
      items?: string[];
      alias?: string;
    }
  >;
  exceptions: [];
}

loadLocal();
const inventoryItems = getAll('DestinyInventoryItemDefinition');
const collectibles = getAll('DestinyCollectibleDefinition');

const missingCollectibleHashes: Record<number, number[]> = {};

// Every Inventory Item without a collectible hash
const nonCollectibleItems = inventoryItems.filter((item) => !item.collectibleHash);

// Every Inventory Item with a collectible hash
const collectibleItems = inventoryItems.filter((item) => item.collectibleHash);

collectibleItems.forEach((collectibleItem) => {
  const itemsWithSameName = nonCollectibleItems.filter(
    (nonCollectibleItem) =>
      collectibleItem.displayProperties.name === nonCollectibleItem.displayProperties.name &&
      JSON.stringify(collectibleItem.itemCategoryHashes.sort()) ===
        JSON.stringify(nonCollectibleItem.itemCategoryHashes.sort())
  );

  itemsWithSameName.forEach((nonCollectibleItem) => {
    collectibles.filter((collectible) => {
      if (collectibleItem.collectibleHash === collectible.hash) {
        missingCollectibleHashes[collectible.sourceHash!] =
          missingCollectibleHashes[collectible.sourceHash!] ?? [];
        missingCollectibleHashes[collectible.sourceHash!].push(nonCollectibleItem.hash);
      }
    });
  });
});

let sourcesInfo: Record<number, string> = {};
let D2Sources: Record<string, number[]> = {}; // converts search field short source tags to item & source hashes
let newSourceInfo: Record<string, number[]> = {};

// sourcesInfo built from manifest collectibles
collectibles.forEach((collectible) => {
  if (collectible.sourceHash) {
    sourcesInfo[collectible.sourceHash] = collectible.sourceString;
  }
});

// loop through categorization rules
Object.entries((categories as Categories).sources).forEach(([sourceTag, matchRule]) => {
  // string match this category's source descriptions
  D2Sources[sourceTag] = objectSearchValues(sourcesInfo, matchRule);

  if (!D2Sources[sourceTag].length) {
    console.log(`no matching sources for: ${matchRule}`);
  }

  Object.entries(D2Sources).forEach(([sourceTag, sourceHashes]) => {
    Object.entries(missingCollectibleHashes).forEach(([sourceHash, items]) => {
      if (sourceHashes.map(Number).includes(Number(sourceHash))) {
        newSourceInfo[sourceTag] = items;
      }
    });
    newSourceInfo[sourceTag] = uniqAndSortArray(newSourceInfo[sourceTag]);
  });

  // lastly add aliases and copy info
  const alias = (categories as Categories).sources[sourceTag].alias;
  if (alias) {
    newSourceInfo[alias] = newSourceInfo[sourceTag];
  }
});

// sort the object after adding in the aliases
const D2SourcesSorted = sortObject(newSourceInfo);

let pretty = `const missingSources: { [key: string]: number[] } = ${stringifyObject(
  D2SourcesSorted,
  {
    indent: '  ',
  }
)};\n\nexport default missingSources;`;

// annotate the file with sources or item names next to matching hashes
let annotated = annotate(pretty, sourcesInfo);

writeFile('./output/missing-source-info.ts', annotated);

// searches haystack (collected manifest source strings) to match against needleInfo (a categories.json match rule)
// returns a list of source hashes
export function objectSearchValues(
  haystack: Record<number, string>,
  needleInfo: Categories['sources'][string]
) {
  var searchResults = (Object.entries(haystack) as unknown) as [number, string][]; // [[hash, string],[hash, string],[hash, string]]

  // filter down to only search results that match conditions
  searchResults = searchResults.filter(
    ([, sourceString]) =>
      // do inclusion strings match this sourceString?
      needleInfo.includes?.filter((searchTerm) =>
        sourceString.toLowerCase().includes(searchTerm.toLowerCase())
      ).length &&
      // not any excludes or not any exclude matches
      !(
        // do exclusion strings match this sourceString?
        needleInfo.excludes?.filter((searchTerm) =>
          sourceString.toLowerCase().includes(searchTerm.toLowerCase())
        ).length
      )
  );
  // extracts key 0 (sourcehash) from searchResults
  return [...new Set(searchResults.map((result) => result[0]))];
}
