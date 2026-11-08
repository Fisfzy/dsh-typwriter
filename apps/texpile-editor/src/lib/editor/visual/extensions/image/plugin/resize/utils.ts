/* eslint-disable no-param-reassign -- resize chrome is positioned by writing the handed element's style */
import { ResizeDirection } from '../../types';

function setHeight(element: HTMLElement, width: number, height: number) {
	element.style.height = `${height}px`;
}
function setWidth(element: HTMLElement, width: number) {
	element.style.width = `${width}px`;
}
export function setSize(element: HTMLElement, width: number, height: number) {
	element.style.height = `${height}px`;

	element.style.width = `${width}px`;
}
export const resizeFunctions: {
	[direction in ResizeDirection]: (element: HTMLElement, width: number, height: number) => void;
} = {
	[ResizeDirection.LEFT]: setWidth,
	[ResizeDirection.TOP_LEFT]: setSize,
	[ResizeDirection.TOP]: setHeight,
	[ResizeDirection.TOP_RIGHT]: setSize,
	[ResizeDirection.RIGHT]: setWidth,
	[ResizeDirection.BOTTOM_RIGHT]: setSize,
	[ResizeDirection.BOTTOM]: setHeight,
	[ResizeDirection.BOTTOM_LEFT]: setSize
};
