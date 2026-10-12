// India's railways around 1951, when the zonal railways were formed: broad gauge trunk lines
// built by the old companies (GIP, EIR, BB&CI, BNR, MSM), and large metre gauge systems in
// Rajasthan, Saurashtra, the Nizam's dominions, the south and the north-east. Simplified to
// the cities on the map; a line here stands for the route between two stations.

import type { Gauge } from '../sim/network';

export const START_FUNDS_1951 = 400;

export const LINES_1951: [string, string, Gauge][] = [
  // Great Indian Peninsula
  ['CSMT', 'PUNE', 'bg'], ['PUNE', 'SUR', 'bg'], ['CSMT', 'NK', 'bg'], ['NK', 'BPL', 'bg'],
  ['BPL', 'VGLJ', 'bg'], ['VGLJ', 'GWL', 'bg'], ['GWL', 'AGC', 'bg'], ['BPL', 'NGP', 'bg'], ['BPL', 'JBP', 'bg'],
  // East Indian
  ['HWH', 'DHN', 'bg'], ['DHN', 'BSB', 'bg'], ['PNBE', 'BSB', 'bg'], ['BSB', 'PRYJ', 'bg'], ['PRYJ', 'CNB', 'bg'],
  ['CNB', 'AGC', 'bg'], ['AGC', 'NDLS', 'bg'], ['CNB', 'LKO', 'bg'], ['JBP', 'PRYJ', 'bg'], ['NDLS', 'DDN', 'bg'],
  // North Western
  ['NDLS', 'LDH', 'bg'], ['LDH', 'ASR', 'bg'],
  // Bombay, Baroda & Central India
  ['CSMT', 'ST', 'bg'], ['ST', 'BRC', 'bg'], ['BRC', 'ADI', 'bg'], ['BRC', 'KOTA', 'bg'], ['KOTA', 'AGC', 'bg'],
  // Bengal Nagpur and the east coast
  ['NGP', 'R', 'bg'], ['HWH', 'BBS', 'bg'], ['BBS', 'PURI', 'bg'], ['BBS', 'VSKP', 'bg'], ['VSKP', 'BZA', 'bg'],
  // Madras & Southern Mahratta, South Indian (broad gauge)
  ['BZA', 'MAS', 'bg'], ['MAS', 'SBC', 'bg'], ['MAS', 'SA', 'bg'], ['SA', 'CBE', 'bg'], ['CBE', 'ERS', 'bg'],
  ['ERS', 'MAQ', 'bg'], ['SUR', 'HYB', 'bg'], ['HYB', 'BZA', 'bg'],
  // metre gauge
  ['NDLS', 'JP', 'mg'], ['JP', 'UDZ', 'mg'], ['UDZ', 'ADI', 'mg'], ['JP', 'JU', 'mg'], ['JU', 'BKN', 'mg'],
  ['ADI', 'RJT', 'mg'], ['LKO', 'GKP', 'mg'], ['GKP', 'NJP', 'mg'], ['NJP', 'GHY', 'mg'],
  ['MAS', 'MDU', 'mg'], ['MDU', 'TVC', 'mg'], ['SBC', 'MYS', 'mg'], ['SBC', 'UBL', 'mg'], ['UBL', 'MAO', 'mg'],
  ['HYB', 'AWB', 'mg'], ['AWB', 'NK', 'mg'], ['DHN', 'RNC', 'mg'],
];
