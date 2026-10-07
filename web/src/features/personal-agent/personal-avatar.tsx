type Appearance = 'spark' | 'cloud' | 'bean';

export function PersonalAvatar({ appearance, className = '' }: { appearance: Appearance; className?: string }) {
  return <svg className={className} viewBox="0 0 80 80" fill="none" role="img" aria-label={appearance}>
    {appearance === 'spark' && <path d="M40 6c5.8 0 8.7 10.2 12.8 16.6 4.1 6.4 14.9 7.8 16.3 15.2 1.4 7.2-8.3 11.5-13.6 17.1C50.2 60.2 47.1 73 40 73S29.8 60.2 24.5 55.9C19.2 51.6 9.5 47.3 10.9 40.1c1.4-7.4 12.2-8.8 16.3-15.2C31.3 18.5 34.2 6 40 6Z" fill="#F7D978" stroke="#E5BC5E" strokeWidth="2" />}
    {appearance === 'cloud' && <path d="M20 55.5C12 55.5 7 50.4 7 43.8c0-6.1 4.1-10.7 10-11.8C18.7 22.6 26 16 35.3 16c7.4 0 13.1 4.4 15.7 10.8 2.1-1.1 4.3-1.6 6.8-1.6 8.8 0 15.2 6.5 15.2 15 0 8.9-7.4 15.3-17.1 15.3H20Z" fill="#ADDDF4" stroke="#82C4E5" strokeWidth="2" />}
    {appearance === 'bean' && <path d="M43 8C61 7 71 21.6 69 40.1 67 58.6 55.9 71.3 39.4 70c-16.7-1.3-30.6-10.9-28.8-27.6C12.5 26 25.7 8.8 43 8Z" fill="#CBE7A0" stroke="#A9CF7A" strokeWidth="2" />}
    <path d="M29 39c0 3 1.5 5 3.7 5s3.8-2 3.8-5M45 39c0 3 1.5 5 3.7 5s3.8-2 3.8-5" stroke="#42504B" strokeWidth="2.8" strokeLinecap="round" />
    <path d="M37.5 50.5c2.2 2.4 5.4 2.4 7.5 0" stroke="#42504B" strokeWidth="2.1" strokeLinecap="round" />
    <ellipse cx="23" cy="47" rx="4" ry="2.2" fill="#F8AFA7" opacity=".72" />
    <ellipse cx="58" cy="47" rx="4" ry="2.2" fill="#F8AFA7" opacity=".72" />
  </svg>;
}
