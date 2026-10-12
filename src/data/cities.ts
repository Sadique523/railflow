import { project } from './geo';

export interface City {
  id: string; // station code
  name: string;
  lat: number;
  lon: number;
  pop: number; // metro population, millions
  x: number;
  z: number;
}

// [code, name, lat, lon, population (millions)]
const RAW: [string, string, number, number, number][] = [
  ['NDLS', 'Delhi', 28.61, 77.21, 32],
  ['CSMT', 'Mumbai', 19.08, 72.88, 21],
  ['HWH', 'Kolkata', 22.57, 88.36, 15],
  ['MAS', 'Chennai', 13.08, 80.27, 11],
  ['SBC', 'Bengaluru', 12.97, 77.59, 13],
  ['HYB', 'Hyderabad', 17.39, 78.49, 10.5],
  ['ADI', 'Ahmedabad', 23.02, 72.57, 8.5],
  ['PUNE', 'Pune', 18.52, 73.86, 7],
  ['ST', 'Surat', 21.17, 72.83, 7],
  ['JP', 'Jaipur', 26.91, 75.79, 4],
  ['LKO', 'Lucknow', 26.85, 80.95, 3.7],
  ['CNB', 'Kanpur', 26.45, 80.33, 3.1],
  ['NGP', 'Nagpur', 21.15, 79.09, 2.9],
  ['INDB', 'Indore', 22.72, 75.86, 3.2],
  ['BPL', 'Bhopal', 23.26, 77.41, 2.4],
  ['PNBE', 'Patna', 25.59, 85.14, 2.5],
  ['BRC', 'Vadodara', 22.31, 73.18, 2.2],
  ['LDH', 'Ludhiana', 30.9, 75.86, 1.9],
  ['AGC', 'Agra', 27.18, 78.01, 1.9],
  ['BSB', 'Varanasi', 25.32, 82.97, 1.6],
  ['VSKP', 'Visakhapatnam', 17.69, 83.22, 2.3],
  ['ERS', 'Kochi', 9.93, 76.27, 2.1],
  ['CBE', 'Coimbatore', 11.02, 76.96, 2.6],
  ['MDU', 'Madurai', 9.93, 78.12, 1.6],
  ['GHY', 'Guwahati', 26.14, 91.74, 1.1],
  ['BBS', 'Bhubaneswar', 20.3, 85.82, 1.2],
  ['RNC', 'Ranchi', 23.34, 85.31, 1.5],
  ['R', 'Raipur', 21.25, 81.63, 1.4],
  ['ASR', 'Amritsar', 31.63, 74.87, 1.3],
  ['CDG', 'Chandigarh', 30.73, 76.78, 1.2],
  ['DDN', 'Dehradun', 30.32, 78.03, 0.8],
  ['JU', 'Jodhpur', 26.24, 73.02, 1.4],
  ['TVC', 'Thiruvananthapuram', 8.52, 76.94, 1.7],
  ['MAO', 'Madgaon', 15.27, 73.96, 0.5],
  ['MAQ', 'Mangaluru', 12.91, 74.86, 0.7],
  ['BZA', 'Vijayawada', 16.51, 80.65, 1.7],
  ['JAT', 'Jammu', 32.73, 74.86, 0.7],
  ['GKP', 'Gorakhpur', 26.76, 83.37, 0.8],
  ['JBP', 'Jabalpur', 23.18, 79.95, 1.3],
  ['UDZ', 'Udaipur', 24.59, 73.71, 0.6],
  ['NJP', 'Siliguri', 26.73, 88.4, 0.8],
  ['MYS', 'Mysuru', 12.3, 76.64, 1.0],
  ['TPTY', 'Tirupati', 13.63, 79.42, 0.5],
  ['NK', 'Nashik', 20.0, 73.79, 2.0],
  ['AWB', 'Aurangabad', 19.88, 75.34, 1.4],
  ['GWL', 'Gwalior', 26.22, 78.18, 1.2],
  ['PRYJ', 'Prayagraj', 25.44, 81.85, 1.5],
  ['KOTA', 'Kota', 25.18, 75.83, 1.2],
  ['RJT', 'Rajkot', 22.3, 70.8, 1.5],
  ['UBL', 'Hubballi', 15.36, 75.12, 1.0],
  ['DHN', 'Dhanbad', 23.8, 86.43, 1.2],
  ['VGLJ', 'Jhansi', 25.45, 78.57, 0.6],
  ['SUR', 'Solapur', 17.66, 75.91, 1.0],
  ['BKN', 'Bikaner', 28.02, 73.31, 0.7],
  ['SA', 'Salem', 11.66, 78.15, 0.9],
  ['PURI', 'Puri', 19.81, 85.83, 0.3],
  ['SML', 'Shimla', 31.1, 77.17, 0.2],
];

export const CITIES: City[] = RAW.map(([id, name, lat, lon, pop]) => ({
  id, name, lat, lon, pop, ...project(lat, lon),
}));

export const CITY_BY_ID = new Map(CITIES.map((c) => [c.id, c]));

export function city(id: string): City {
  const c = CITY_BY_ID.get(id);
  if (!c) throw new Error(`Unknown city ${id}`);
  return c;
}

/** Radius of a city's blue station plaza, in world units. */
export function plazaSize(c: City): number {
  return (4.5 + Math.sqrt(c.pop) * 1.1) * 1.5;
}
