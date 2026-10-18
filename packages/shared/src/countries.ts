// Countries an institution can be in, and what follows from the choice: the currency, the
// timezone (the capital's, editable for countries with several), number and date formats
// (always English, the region's style) and the first day of the week. Payment gateways also
// follow the country: Pakistan uses JazzCash and Easypaisa, every other country Stripe.
import { z } from 'zod';

export interface Country {
  /** ISO 3166-1 alpha-2 */
  code: string;
  name: string;
  /** ISO 4217 */
  currency: string;
  /** IANA timezone of the capital (or the largest city) */
  timezone: string;
}

const C = (code: string, name: string, currency: string, timezone: string): Country => ({ code, name, currency, timezone });

export const COUNTRIES: readonly Country[] = [
  C('AF', 'Afghanistan', 'AFN', 'Asia/Kabul'),
  C('AL', 'Albania', 'ALL', 'Europe/Tirane'),
  C('DZ', 'Algeria', 'DZD', 'Africa/Algiers'),
  C('AD', 'Andorra', 'EUR', 'Europe/Andorra'),
  C('AO', 'Angola', 'AOA', 'Africa/Luanda'),
  C('AG', 'Antigua and Barbuda', 'XCD', 'America/Antigua'),
  C('AR', 'Argentina', 'ARS', 'America/Argentina/Buenos_Aires'),
  C('AM', 'Armenia', 'AMD', 'Asia/Yerevan'),
  C('AU', 'Australia', 'AUD', 'Australia/Sydney'),
  C('AT', 'Austria', 'EUR', 'Europe/Vienna'),
  C('AZ', 'Azerbaijan', 'AZN', 'Asia/Baku'),
  C('BS', 'Bahamas', 'BSD', 'America/Nassau'),
  C('BH', 'Bahrain', 'BHD', 'Asia/Bahrain'),
  C('BD', 'Bangladesh', 'BDT', 'Asia/Dhaka'),
  C('BB', 'Barbados', 'BBD', 'America/Barbados'),
  C('BY', 'Belarus', 'BYN', 'Europe/Minsk'),
  C('BE', 'Belgium', 'EUR', 'Europe/Brussels'),
  C('BZ', 'Belize', 'BZD', 'America/Belize'),
  C('BJ', 'Benin', 'XOF', 'Africa/Porto-Novo'),
  C('BT', 'Bhutan', 'BTN', 'Asia/Thimphu'),
  C('BO', 'Bolivia', 'BOB', 'America/La_Paz'),
  C('BA', 'Bosnia and Herzegovina', 'BAM', 'Europe/Sarajevo'),
  C('BW', 'Botswana', 'BWP', 'Africa/Gaborone'),
  C('BR', 'Brazil', 'BRL', 'America/Sao_Paulo'),
  C('BN', 'Brunei', 'BND', 'Asia/Brunei'),
  C('BG', 'Bulgaria', 'EUR', 'Europe/Sofia'),
  C('BF', 'Burkina Faso', 'XOF', 'Africa/Ouagadougou'),
  C('BI', 'Burundi', 'BIF', 'Africa/Bujumbura'),
  C('CV', 'Cabo Verde', 'CVE', 'Atlantic/Cape_Verde'),
  C('KH', 'Cambodia', 'KHR', 'Asia/Phnom_Penh'),
  C('CM', 'Cameroon', 'XAF', 'Africa/Douala'),
  C('CA', 'Canada', 'CAD', 'America/Toronto'),
  C('CF', 'Central African Republic', 'XAF', 'Africa/Bangui'),
  C('TD', 'Chad', 'XAF', 'Africa/Ndjamena'),
  C('CL', 'Chile', 'CLP', 'America/Santiago'),
  C('CN', 'China', 'CNY', 'Asia/Shanghai'),
  C('CO', 'Colombia', 'COP', 'America/Bogota'),
  C('KM', 'Comoros', 'KMF', 'Indian/Comoro'),
  C('CG', 'Congo', 'XAF', 'Africa/Brazzaville'),
  C('CD', 'Congo (DRC)', 'CDF', 'Africa/Kinshasa'),
  C('CR', 'Costa Rica', 'CRC', 'America/Costa_Rica'),
  C('CI', "Côte d'Ivoire", 'XOF', 'Africa/Abidjan'),
  C('HR', 'Croatia', 'EUR', 'Europe/Zagreb'),
  C('CU', 'Cuba', 'CUP', 'America/Havana'),
  C('CY', 'Cyprus', 'EUR', 'Asia/Nicosia'),
  C('CZ', 'Czechia', 'CZK', 'Europe/Prague'),
  C('DK', 'Denmark', 'DKK', 'Europe/Copenhagen'),
  C('DJ', 'Djibouti', 'DJF', 'Africa/Djibouti'),
  C('DM', 'Dominica', 'XCD', 'America/Dominica'),
  C('DO', 'Dominican Republic', 'DOP', 'America/Santo_Domingo'),
  C('EC', 'Ecuador', 'USD', 'America/Guayaquil'),
  C('EG', 'Egypt', 'EGP', 'Africa/Cairo'),
  C('SV', 'El Salvador', 'USD', 'America/El_Salvador'),
  C('GQ', 'Equatorial Guinea', 'XAF', 'Africa/Malabo'),
  C('ER', 'Eritrea', 'ERN', 'Africa/Asmara'),
  C('EE', 'Estonia', 'EUR', 'Europe/Tallinn'),
  C('SZ', 'Eswatini', 'SZL', 'Africa/Mbabane'),
  C('ET', 'Ethiopia', 'ETB', 'Africa/Addis_Ababa'),
  C('FJ', 'Fiji', 'FJD', 'Pacific/Fiji'),
  C('FI', 'Finland', 'EUR', 'Europe/Helsinki'),
  C('FR', 'France', 'EUR', 'Europe/Paris'),
  C('GA', 'Gabon', 'XAF', 'Africa/Libreville'),
  C('GM', 'Gambia', 'GMD', 'Africa/Banjul'),
  C('GE', 'Georgia', 'GEL', 'Asia/Tbilisi'),
  C('DE', 'Germany', 'EUR', 'Europe/Berlin'),
  C('GH', 'Ghana', 'GHS', 'Africa/Accra'),
  C('GR', 'Greece', 'EUR', 'Europe/Athens'),
  C('GD', 'Grenada', 'XCD', 'America/Grenada'),
  C('GT', 'Guatemala', 'GTQ', 'America/Guatemala'),
  C('GN', 'Guinea', 'GNF', 'Africa/Conakry'),
  C('GW', 'Guinea-Bissau', 'XOF', 'Africa/Bissau'),
  C('GY', 'Guyana', 'GYD', 'America/Guyana'),
  C('HT', 'Haiti', 'HTG', 'America/Port-au-Prince'),
  C('HN', 'Honduras', 'HNL', 'America/Tegucigalpa'),
  C('HK', 'Hong Kong', 'HKD', 'Asia/Hong_Kong'),
  C('HU', 'Hungary', 'HUF', 'Europe/Budapest'),
  C('IS', 'Iceland', 'ISK', 'Atlantic/Reykjavik'),
  C('IN', 'India', 'INR', 'Asia/Kolkata'),
  C('ID', 'Indonesia', 'IDR', 'Asia/Jakarta'),
  C('IR', 'Iran', 'IRR', 'Asia/Tehran'),
  C('IQ', 'Iraq', 'IQD', 'Asia/Baghdad'),
  C('IE', 'Ireland', 'EUR', 'Europe/Dublin'),
  C('IL', 'Israel', 'ILS', 'Asia/Jerusalem'),
  C('IT', 'Italy', 'EUR', 'Europe/Rome'),
  C('JM', 'Jamaica', 'JMD', 'America/Jamaica'),
  C('JP', 'Japan', 'JPY', 'Asia/Tokyo'),
  C('JO', 'Jordan', 'JOD', 'Asia/Amman'),
  C('KZ', 'Kazakhstan', 'KZT', 'Asia/Almaty'),
  C('KE', 'Kenya', 'KES', 'Africa/Nairobi'),
  C('KI', 'Kiribati', 'AUD', 'Pacific/Tarawa'),
  C('KW', 'Kuwait', 'KWD', 'Asia/Kuwait'),
  C('KG', 'Kyrgyzstan', 'KGS', 'Asia/Bishkek'),
  C('LA', 'Laos', 'LAK', 'Asia/Vientiane'),
  C('LV', 'Latvia', 'EUR', 'Europe/Riga'),
  C('LB', 'Lebanon', 'LBP', 'Asia/Beirut'),
  C('LS', 'Lesotho', 'LSL', 'Africa/Maseru'),
  C('LR', 'Liberia', 'LRD', 'Africa/Monrovia'),
  C('LY', 'Libya', 'LYD', 'Africa/Tripoli'),
  C('LI', 'Liechtenstein', 'CHF', 'Europe/Vaduz'),
  C('LT', 'Lithuania', 'EUR', 'Europe/Vilnius'),
  C('LU', 'Luxembourg', 'EUR', 'Europe/Luxembourg'),
  C('MO', 'Macao', 'MOP', 'Asia/Macau'),
  C('MG', 'Madagascar', 'MGA', 'Indian/Antananarivo'),
  C('MW', 'Malawi', 'MWK', 'Africa/Blantyre'),
  C('MY', 'Malaysia', 'MYR', 'Asia/Kuala_Lumpur'),
  C('MV', 'Maldives', 'MVR', 'Indian/Maldives'),
  C('ML', 'Mali', 'XOF', 'Africa/Bamako'),
  C('MT', 'Malta', 'EUR', 'Europe/Malta'),
  C('MH', 'Marshall Islands', 'USD', 'Pacific/Majuro'),
  C('MR', 'Mauritania', 'MRU', 'Africa/Nouakchott'),
  C('MU', 'Mauritius', 'MUR', 'Indian/Mauritius'),
  C('MX', 'Mexico', 'MXN', 'America/Mexico_City'),
  C('FM', 'Micronesia', 'USD', 'Pacific/Pohnpei'),
  C('MD', 'Moldova', 'MDL', 'Europe/Chisinau'),
  C('MC', 'Monaco', 'EUR', 'Europe/Monaco'),
  C('MN', 'Mongolia', 'MNT', 'Asia/Ulaanbaatar'),
  C('ME', 'Montenegro', 'EUR', 'Europe/Podgorica'),
  C('MA', 'Morocco', 'MAD', 'Africa/Casablanca'),
  C('MZ', 'Mozambique', 'MZN', 'Africa/Maputo'),
  C('MM', 'Myanmar', 'MMK', 'Asia/Yangon'),
  C('NA', 'Namibia', 'NAD', 'Africa/Windhoek'),
  C('NR', 'Nauru', 'AUD', 'Pacific/Nauru'),
  C('NP', 'Nepal', 'NPR', 'Asia/Kathmandu'),
  C('NL', 'Netherlands', 'EUR', 'Europe/Amsterdam'),
  C('NZ', 'New Zealand', 'NZD', 'Pacific/Auckland'),
  C('NI', 'Nicaragua', 'NIO', 'America/Managua'),
  C('NE', 'Niger', 'XOF', 'Africa/Niamey'),
  C('NG', 'Nigeria', 'NGN', 'Africa/Lagos'),
  C('MK', 'North Macedonia', 'MKD', 'Europe/Skopje'),
  C('NO', 'Norway', 'NOK', 'Europe/Oslo'),
  C('OM', 'Oman', 'OMR', 'Asia/Muscat'),
  C('PK', 'Pakistan', 'PKR', 'Asia/Karachi'),
  C('PW', 'Palau', 'USD', 'Pacific/Palau'),
  C('PS', 'Palestine', 'ILS', 'Asia/Hebron'),
  C('PA', 'Panama', 'USD', 'America/Panama'),
  C('PG', 'Papua New Guinea', 'PGK', 'Pacific/Port_Moresby'),
  C('PY', 'Paraguay', 'PYG', 'America/Asuncion'),
  C('PE', 'Peru', 'PEN', 'America/Lima'),
  C('PH', 'Philippines', 'PHP', 'Asia/Manila'),
  C('PL', 'Poland', 'PLN', 'Europe/Warsaw'),
  C('PT', 'Portugal', 'EUR', 'Europe/Lisbon'),
  C('PR', 'Puerto Rico', 'USD', 'America/Puerto_Rico'),
  C('QA', 'Qatar', 'QAR', 'Asia/Qatar'),
  C('RO', 'Romania', 'RON', 'Europe/Bucharest'),
  C('RU', 'Russia', 'RUB', 'Europe/Moscow'),
  C('RW', 'Rwanda', 'RWF', 'Africa/Kigali'),
  C('KN', 'Saint Kitts and Nevis', 'XCD', 'America/St_Kitts'),
  C('LC', 'Saint Lucia', 'XCD', 'America/St_Lucia'),
  C('VC', 'Saint Vincent and the Grenadines', 'XCD', 'America/St_Vincent'),
  C('WS', 'Samoa', 'WST', 'Pacific/Apia'),
  C('SM', 'San Marino', 'EUR', 'Europe/San_Marino'),
  C('ST', 'São Tomé and Príncipe', 'STN', 'Africa/Sao_Tome'),
  C('SA', 'Saudi Arabia', 'SAR', 'Asia/Riyadh'),
  C('SN', 'Senegal', 'XOF', 'Africa/Dakar'),
  C('RS', 'Serbia', 'RSD', 'Europe/Belgrade'),
  C('SC', 'Seychelles', 'SCR', 'Indian/Mahe'),
  C('SL', 'Sierra Leone', 'SLE', 'Africa/Freetown'),
  C('SG', 'Singapore', 'SGD', 'Asia/Singapore'),
  C('SK', 'Slovakia', 'EUR', 'Europe/Bratislava'),
  C('SI', 'Slovenia', 'EUR', 'Europe/Ljubljana'),
  C('SB', 'Solomon Islands', 'SBD', 'Pacific/Guadalcanal'),
  C('SO', 'Somalia', 'SOS', 'Africa/Mogadishu'),
  C('ZA', 'South Africa', 'ZAR', 'Africa/Johannesburg'),
  C('KR', 'South Korea', 'KRW', 'Asia/Seoul'),
  C('SS', 'South Sudan', 'SSP', 'Africa/Juba'),
  C('ES', 'Spain', 'EUR', 'Europe/Madrid'),
  C('LK', 'Sri Lanka', 'LKR', 'Asia/Colombo'),
  C('SD', 'Sudan', 'SDG', 'Africa/Khartoum'),
  C('SR', 'Suriname', 'SRD', 'America/Paramaribo'),
  C('SE', 'Sweden', 'SEK', 'Europe/Stockholm'),
  C('CH', 'Switzerland', 'CHF', 'Europe/Zurich'),
  C('SY', 'Syria', 'SYP', 'Asia/Damascus'),
  C('TW', 'Taiwan', 'TWD', 'Asia/Taipei'),
  C('TJ', 'Tajikistan', 'TJS', 'Asia/Dushanbe'),
  C('TZ', 'Tanzania', 'TZS', 'Africa/Dar_es_Salaam'),
  C('TH', 'Thailand', 'THB', 'Asia/Bangkok'),
  C('TL', 'Timor-Leste', 'USD', 'Asia/Dili'),
  C('TG', 'Togo', 'XOF', 'Africa/Lome'),
  C('TO', 'Tonga', 'TOP', 'Pacific/Tongatapu'),
  C('TT', 'Trinidad and Tobago', 'TTD', 'America/Port_of_Spain'),
  C('TN', 'Tunisia', 'TND', 'Africa/Tunis'),
  C('TR', 'Türkiye', 'TRY', 'Europe/Istanbul'),
  C('TM', 'Turkmenistan', 'TMT', 'Asia/Ashgabat'),
  C('TV', 'Tuvalu', 'AUD', 'Pacific/Funafuti'),
  C('UG', 'Uganda', 'UGX', 'Africa/Kampala'),
  C('UA', 'Ukraine', 'UAH', 'Europe/Kyiv'),
  C('AE', 'United Arab Emirates', 'AED', 'Asia/Dubai'),
  C('GB', 'United Kingdom', 'GBP', 'Europe/London'),
  C('US', 'United States', 'USD', 'America/New_York'),
  C('UY', 'Uruguay', 'UYU', 'America/Montevideo'),
  C('UZ', 'Uzbekistan', 'UZS', 'Asia/Tashkent'),
  C('VU', 'Vanuatu', 'VUV', 'Pacific/Efate'),
  C('VE', 'Venezuela', 'VES', 'America/Caracas'),
  C('VN', 'Vietnam', 'VND', 'Asia/Ho_Chi_Minh'),
  C('YE', 'Yemen', 'YER', 'Asia/Aden'),
  C('ZM', 'Zambia', 'ZMW', 'Africa/Lusaka'),
  C('ZW', 'Zimbabwe', 'USD', 'Africa/Harare'),
];

const BY_CODE = new Map(COUNTRIES.map((c) => [c.code, c]));

export const findCountry = (code: string | null | undefined): Country | undefined => (code ? BY_CODE.get(code.toUpperCase()) : undefined);
export const isCountryCode = (code: string) => BY_CODE.has(code.toUpperCase());

/** Where the school week starts on Sunday or Saturday (Monday elsewhere). Editable in Settings. */
const SUNDAY_START = new Set(['US', 'CA', 'BR', 'MX', 'JP', 'KR', 'PH', 'IL', 'SA', 'YE', 'IN', 'BD', 'ZA']);
const SATURDAY_START = new Set(['AF', 'IR', 'EG', 'DZ', 'LY', 'SD', 'SY', 'IQ', 'JO', 'KW', 'QA', 'BH', 'OM', 'DJ']);

export interface CountryDefaults {
  country: string;
  currency: string;
  timezone: string;
  /** English everywhere, with the region's number and date style */
  locale: string;
  /** 0 = Sunday … 6 = Saturday */
  weekStart: number;
}

/** What an institution in this country starts with. Unknown codes are refused by the schemas. */
export function countryDefaults(code: string): CountryDefaults {
  const c = findCountry(code);
  if (!c) throw new Error(`unknown country: ${code}`);
  return { country: c.code, currency: c.currency, timezone: c.timezone, locale: `en-${c.code}`, weekStart: SUNDAY_START.has(c.code) ? 0 : SATURDAY_START.has(c.code) ? 6 : 1 };
}

// ---------------------------------------------------------------- payment gateways

export type OnlineGateway = 'stripe' | 'jazzcash' | 'easypaisa';

/** Countries with their own gateways; everywhere else uses Stripe. */
const LOCAL_GATEWAYS: Record<string, OnlineGateway[]> = {
  PK: ['jazzcash', 'easypaisa'],
};

/** The online payment gateways an institution in this country can connect. */
export const onlineGatewaysFor = (country: string | null | undefined): OnlineGateway[] => LOCAL_GATEWAYS[(country ?? '').toUpperCase()] ?? ['stripe'];

/** A country from COUNTRIES (two-letter code). */
export const countryCode = z.string().trim().toUpperCase().refine(isCountryCode, 'Choose a country from the list');
