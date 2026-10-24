import { useId, useState } from "react";
import type { ProjectionPoint } from "../domain/projections";
import { usd } from "./ui";

export function ProjectionChart({
	points,
	kind,
	currentAge,
}: {
	points: ProjectionPoint[];
	kind: "cash" | "investments";
	currentAge: number;
}) {
	const id = useId();
	const [selected, setSelected] = useState(points.length - 1);
	const index = Math.max(0, Math.min(selected, points.length - 1));
	const point = points[index];
	const max = Math.max(100, ...points.map((p) => p[kind]));
	const width = 600,
		height = 220,
		left = 64,
		right = 16,
		top = 15,
		bottom = 32;
	const x = (month: number) =>
		left + (month / (points.length - 1)) * (width - left - right);
	const y = (value: number) =>
		height - bottom - (value / max) * (height - top - bottom);
	const path = points
		.map(
			(p, i) =>
				`${i ? "L" : "M"}${x(p.month).toFixed(2)},${y(p[kind]).toFixed(2)}`,
		)
		.join(" ");
	const title = kind === "cash" ? "Cash savings" : "Investments";
	return (
		<section className={`panel projection-chart projection-${kind}`}>
			<div className="section-heading">
				<h2>{title}</h2>
				<span>
					At age{" "}
					{currentAge + point.month / 12 ===
					Math.floor(currentAge + point.month / 12)
						? currentAge + point.month / 12
						: (currentAge + point.month / 12).toFixed(1)}
				</span>
			</div>
			<strong className="projection-value">{usd(point[kind])}</strong>
			<svg viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={id}>
				<title id={id}>
					{title} from age {currentAge} to{" "}
					{currentAge + (points.length - 1) / 12}. Use the month slider or the
					yearly table for exact values.
				</title>
				{[0, 0.5, 1].map((fraction) => (
					<g key={fraction}>
						<line
							x1={left}
							x2={width - right}
							y1={y(max * fraction)}
							y2={y(max * fraction)}
							className="projection-gridline"
						/>
						<text x={left - 8} y={y(max * fraction) + 4} textAnchor="end">
							{new Intl.NumberFormat("en-US", {
								notation: "compact",
								maximumFractionDigits: 1,
								style: "currency",
								currency: "USD",
							}).format((max * fraction) / 100)}
						</text>
					</g>
				))}
				<path
					d={path}
					fill="none"
					className="projection-line"
					strokeWidth="3"
				/>
				<line
					x1={x(point.month)}
					x2={x(point.month)}
					y1={top}
					y2={height - bottom}
					className="projection-marker"
				/>
				<circle
					cx={x(point.month)}
					cy={y(point[kind])}
					r="4"
					className="projection-dot"
				/>
				{[0, 0.5, 1].map((fraction) => (
					<text
						key={fraction}
						x={x((points.length - 1) * fraction)}
						y={height - 8}
						textAnchor="middle"
					>
						Age {Math.round(currentAge + ((points.length - 1) * fraction) / 12)}
					</text>
				))}
			</svg>
			<label>
				Explore {title.toLowerCase()} by month
				<input
					aria-label={`${title} forecast month`}
					type="range"
					min="0"
					max={points.length - 1}
					value={index}
					onChange={(e) => setSelected(Number(e.target.value))}
				/>
			</label>
		</section>
	);
}
