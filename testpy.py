from pygooglenews import GoogleNews

gn = GoogleNews()
# search for the best matching articles that mention MSFT and 
# do not mention AAPL (over the past 6 month
search = gn.search('Waymo AND Toyota', when = '6m')
print(search['feed'].title)