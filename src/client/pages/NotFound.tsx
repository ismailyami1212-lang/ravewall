import { Link } from 'react-router-dom'
import { Logo } from '../components/Primitives'

export function NotFound() {
  return (
    <div className="center-screen">
      <div className="notfound">
        <Logo />
        <h1>Page not found</h1>
        <p className="muted">
          The page you were looking for does not exist. If you followed a testimonial link, check
          with the business that shared it.
        </p>
        <Link to="/" className="btn btn-primary">
          Back to home
        </Link>
      </div>
    </div>
  )
}
