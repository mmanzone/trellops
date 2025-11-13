URL: https://trello-dashboard-drab.vercel.app/

# Purpose
Trello allows a lot of customisation and organisation set up their lists specifically for their business need. Some of them use Trello for operaational activities and need to have a simple customisable interface to see specifics metrics per list. Some power-ups allow to display a card counter in Trello for the board or a list, but the interface still show the lists, cards and may not be easy to read.
This dashboard intents to be displayed on a wall screen that the organisation can monitor, like in a service centre, to have a constant close-to-realtime visibility on the workload in each list.

# The solution
A simple dashboard for **ANY** Trello board the user has access too. The user can customise which Trello lists they want to show a counter for as a tile, group the tiles in separate sections. Clicking on a tile shows all the cards listed under this Trello list, including the labels assigned.
A time filter allows to only shows specific card; the filter is based on the cards creation date.
 
# Pre-requisites
A  Trello account is required to login and grant READ access to the boards. All the information is stored on the local computer and is not kept on the servers

# Access

1. Access the page and login with Trello; you'll need to grant the app READ access to all your board
2. Once logged in, you can customise your dashboards.

# Setup

1. Select the Trello board you want to configure a dashboard for, using the dropdown. All the boards you have access to across all workspaces will be displayed here. The configuration is specific for each board
2. You can choose to display a clock on the top right corner (using the browser time configuration) if the board you are configuring is time-sensitive. You can also set the preferred theme (light, dark or following the operating system theme). You can also set the refresh interval in seconds, minute or hours.
3. Define how many sections you want on your dashboard. A Section is a collection of tiles showing the count of cards in a specific list. It allows a separatio between group of lists, and can be collapse on the dashboard. You can rename and reorder the sections at any point in time.
4. The list of lists for the board will appear, and next to them, a button to move them to the sections you've created before. For each list you want to display, click on the button corresponding to the section you want to display them in. Repeat for each list. You do not need to display all lists, only the ones that are relevant.
5. In the sections list, you can rename, movee up or down each section.
6. Inside each section, each list will be displayed as a card. The name is pulled from the Trello board and cannot be changed. You can however change the colour it will appear as, and change the order of the tiles in the section. You can also move a list/tile from one section to the other, or hide it by moving it back into the unassigned pool
7. It is common for organisation to create a Trello card at the top of a list to provide instructions. This card shouldn't be counted as an item in the dashboard; it can be skipped and removed from the total using the "use first card as description". The title of the card will be displayed uner the number in the tile.
8. Once you're satisfied, you can click on the "Save Layout and vie Dashboard" button. The settings will be stored on your local computer and come back for each board when you visit the page again.
9. If you want to use the same layout from different computers, or share your layout with colleagues, you can export the configuration using the button, and import it in the destination computer. Note that a configuration file only apply to a board; you can't duplicate a layout and use it with another board.
10. If you need to start from scratch and delete a layout, simply use the "clear all saved configuratiton for selected board"; this will clear your local cache for this board only.

# Out of scope

* this solution only reads information from Trello and it's impossible to edit any card, list or board information.
* while the time filter allows to update the tile total count of cards in a list, clicking on the tile will show ALL cards in that list, regardless of the time they were created. 
