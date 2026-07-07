import { NavLink } from 'react-router-dom'

const links = [
  { to: '/', label: 'Models' },
  { to: '/chat', label: 'Chat' },
  { to: '/discover', label: 'Discover' },
  { to: '/prompts', label: 'Prompts' },
  { to: '/compare', label: 'Compare' },
]

export default function Navbar() {
  return (
    <nav className="navbar">
      <div className="navbar-brand">ModelCompare</div>
      <div className="navbar-links">
        {links.map(l => (
          <NavLink key={l.to} to={l.to} end={l.to === '/'} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            {l.label}
          </NavLink>
        ))}
      </div>
    </nav>
  )
}
